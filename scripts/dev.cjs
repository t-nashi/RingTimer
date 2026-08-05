const { spawn } = require('node:child_process');

const children = new Set();

function run(command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' }
  });

  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function shutdown() {
  for (const child of children) {
    child.kill();
  }
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(130);
});

process.on('SIGTERM', () => {
  shutdown();
  process.exit(143);
});

async function main() {
  const vite = run('vite', ['--host', '127.0.0.1']);
  vite.on('exit', (code) => {
    if (children.size === 0) return;
    shutdown();
    process.exit(code ?? 1);
  });

  await waitForServer('http://127.0.0.1:5173');
  const electron = run('electron', ['.']);
  electron.on('exit', (code) => {
    shutdown();
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error);
  shutdown();
  process.exit(1);
});
