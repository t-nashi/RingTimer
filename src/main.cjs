const { app, BrowserWindow, dialog, ipcMain, Notification, screen } = require('electron');
const fs = require('node:fs/promises');
const fssync = require('node:fs');
const path = require('node:path');

const isDev = !app.isPackaged;
let mainWindow;
let boundsBeforeMinimal = null;
let contentSizeBeforeMinimal = null;
let pendingMinimalOnListener = null;
let wasMaximizedBeforeMinimal = false;
let isNativeMinimal = false;

const NORMAL_MIN = {
  width: 480,
  height: process.platform === 'win32' ? 820 : 760
};
const DEFAULT_NORMAL_SIZE = { width: 1180, height: Math.max(760, NORMAL_MIN.height) };
const MINIMAL_CONTENT = { width: 380, height: 128 };

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearPendingMinimalOnListener() {
  if (pendingMinimalOnListener && mainWindow) {
    mainWindow.removeListener('leave-full-screen', pendingMinimalOnListener);
  }
  pendingMinimalOnListener = null;
}

function waitForLeaveFullScreen() {
  if (!mainWindow || !mainWindow.isFullScreen()) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 500);
    mainWindow.once('leave-full-screen', () => {
      clearTimeout(timeout);
      resolve();
    });
    mainWindow.setFullScreen(false);
  });
}

function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const state = JSON.parse(fssync.readFileSync(windowStatePath(), 'utf8'));
    return state && typeof state === 'object' ? state : null;
  } catch {
    return null;
  }
}

function isVisibleOnSomeDisplay(bounds) {
  if (!bounds || typeof bounds.x !== 'number' || typeof bounds.y !== 'number') return false;
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    );
  });
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const state = {
      bounds: mainWindow.getNormalBounds(),
      isMaximized: mainWindow.isMaximized(),
      boundsBeforeMinimal,
      contentSizeBeforeMinimal,
      wasMaximizedBeforeMinimal
    };
    fssync.writeFileSync(windowStatePath(), JSON.stringify(state));
  } catch {
    // 保存失敗は起動継続を優先して無視
  }
}

function createWindow() {
  const saved = loadWindowState();
  const savedBounds = saved && isVisibleOnSomeDisplay(saved.bounds) ? saved.bounds : null;
  boundsBeforeMinimal = saved && isVisibleOnSomeDisplay(saved.boundsBeforeMinimal) ? saved.boundsBeforeMinimal : null;
  contentSizeBeforeMinimal = saved?.contentSizeBeforeMinimal ?? null;
  wasMaximizedBeforeMinimal = Boolean(saved?.wasMaximizedBeforeMinimal);
  isNativeMinimal = false;

  mainWindow = new BrowserWindow({
    width: savedBounds ? savedBounds.width : DEFAULT_NORMAL_SIZE.width,
    height: savedBounds ? savedBounds.height : DEFAULT_NORMAL_SIZE.height,
    ...(savedBounds ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: NORMAL_MIN.width,
    minHeight: NORMAL_MIN.height,
    backgroundColor: '#101522',
    title: 'RingTimer',
    icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // バックグラウンド状態でもアニメーション/タイマーの描画が
  // 間引かれないようにする（常時最前面表示のミニ表示や
  // フルスクリーン切り替え直後にコマ落ちして見える問題への対策）。
  mainWindow.webContents.setBackgroundThrottling(false);

  if (saved && saved.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.on('close', saveWindowState);

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('desktop:notify', (_event, payload) => {
  if (Notification.isSupported()) {
    new Notification({
      title: payload.title || 'RingTimer',
      body: payload.body || 'Alarm is ringing'
    }).show();
  }
});

ipcMain.handle('desktop:toggle-fullscreen', () => {
  if (!mainWindow) return false;
  const next = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  return next;
});

ipcMain.handle('desktop:set-minimal', async (_event, on) => {
  if (!mainWindow) return false;

  const applyMinimalOn = async () => {
    pendingMinimalOnListener = null;
    if (isNativeMinimal) return;
    wasMaximizedBeforeMinimal = mainWindow.isMaximized();
    boundsBeforeMinimal = mainWindow.getNormalBounds();
    contentSizeBeforeMinimal = mainWindow.getContentSize();
    if (wasMaximizedBeforeMinimal) {
      mainWindow.unmaximize();
      await wait(50);
    }
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(1, 1);
    mainWindow.setContentSize(MINIMAL_CONTENT.width, MINIMAL_CONTENT.height);
    const [fixedW, fixedH] = mainWindow.getSize();
    mainWindow.setMinimumSize(fixedW, fixedH);
    mainWindow.setMaximumSize(fixedW, fixedH);
    mainWindow.setResizable(false);
    mainWindow.setAlwaysOnTop(true, 'floating');
    isNativeMinimal = true;
  };

  if (on) {
    clearPendingMinimalOnListener();
    await waitForLeaveFullScreen();
    await applyMinimalOn();
  } else {
    clearPendingMinimalOnListener();
    mainWindow.setAlwaysOnTop(false);
    // On Windows, setMinimumSize/setMaximumSize calls made while the window is
    // still non-resizable are silently ignored — the OS keeps enforcing the old
    // minimal-sized min/max lock. setResizable(true) must come first, otherwise
    // the later setBounds/setContentSize calls below stay clamped to that
    // minimal size, leaving the normal UI rendered inside a tiny window.
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(1, 1);
    mainWindow.setMaximumSize(0, 0);

    const restoreBounds = boundsBeforeMinimal;
    const restoreContentSize =
      contentSizeBeforeMinimal && !wasMaximizedBeforeMinimal
        ? [
            Math.max(contentSizeBeforeMinimal[0], NORMAL_MIN.width),
            Math.max(contentSizeBeforeMinimal[1], NORMAL_MIN.height)
          ]
        : null;
    const shouldMaximize = wasMaximizedBeforeMinimal;

    if (restoreBounds) {
      mainWindow.setBounds(restoreBounds);
    }
    if (restoreContentSize) {
      mainWindow.setContentSize(restoreContentSize[0], restoreContentSize[1]);
    } else if (!restoreBounds) {
      mainWindow.setContentSize(DEFAULT_NORMAL_SIZE.width, DEFAULT_NORMAL_SIZE.height);
    }

    mainWindow.setMinimumSize(NORMAL_MIN.width, NORMAL_MIN.height);
    mainWindow.setMaximumSize(0, 0);

    await wait(50);
    if (shouldMaximize) {
      mainWindow.maximize();
    }
    boundsBeforeMinimal = null;
    contentSizeBeforeMinimal = null;
    wasMaximizedBeforeMinimal = false;
    isNativeMinimal = false;
  }
  return true;
});

ipcMain.handle('theme:export', async (_event, theme) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Theme',
    defaultPath: `${theme.name || 'ringtimer-theme'}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });

  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, JSON.stringify(theme, null, 2), 'utf8');
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('theme:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Theme',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });

  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const raw = await fs.readFile(result.filePaths[0], 'utf8');
  return { canceled: false, theme: JSON.parse(raw) };
});
