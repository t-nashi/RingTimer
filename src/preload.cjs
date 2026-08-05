const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  notify: (payload) => ipcRenderer.invoke('desktop:notify', payload),
  toggleFullscreen: () => ipcRenderer.invoke('desktop:toggle-fullscreen'),
  setMinimal: (on) => ipcRenderer.invoke('desktop:set-minimal', on),
  exportTheme: (theme) => ipcRenderer.invoke('theme:export', theme),
  importTheme: () => ipcRenderer.invoke('theme:import')
});
