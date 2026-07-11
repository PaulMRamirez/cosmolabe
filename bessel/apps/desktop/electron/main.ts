import { app, BrowserWindow, session, shell } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpcHandlers } from './ipc-handlers.ts';

const dir = dirname(fileURLToPath(import.meta.url));

// The packaged renderer is served from file://; the dev server (if any) is the only
// other origin we trust. Navigation and window-open to anything else is denied.
function isAppUrl(target: string): boolean {
  const devServer = process.env['ELECTRON_RENDERER_URL'];
  if (devServer && target.startsWith(devServer)) return true;
  return target.startsWith('file://');
}

// A restrictive CSP for the packaged renderer: same-origin only, no remote script or
// connect, WASM allowed for CSPICE, blob/data for worker and texture decode.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0b0e14',
    webPreferences: {
      preload: join(dir, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Deny opening new windows; route any external link through the OS browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAppUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Deny navigation to any non-app origin (prevents a compromised renderer or a stray
  // link from steering the window off the trusted origin).
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });

  const devServer = process.env['ELECTRON_RENDERER_URL'];
  if (devServer) {
    void win.loadURL(devServer);
  } else {
    void win.loadFile(join(dir, '../renderer/index.html'));
  }
}

void app.whenReady().then(() => {
  // Apply the CSP to every response the default session serves to the renderer.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
      },
    });
  });

  registerIpcHandlers();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
