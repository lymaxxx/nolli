import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import path from 'node:path';
import {
  ensureNolliExtension,
  isProjectPath,
  OPEN_FILTERS,
  readProjectFile,
  saveTarget,
  SAVE_FILTERS,
  writeProjectFile,
  type ProjectFile,
} from './fileService';

/**
 * OpenStreetMap's tile policy wants a User-Agent that names the app. A
 * `file://` Referer, which Chromium would otherwise send from the packaged
 * page, is rejected with a 403 "Access blocked" tile.
 */
const TILE_USER_AGENT = 'Nolli/0.1 (wayfinding map editor)';

function configureTileRequests(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://tile.openstreetmap.org/*'] },
    (details, callback) => {
      const headers: Record<string, string> = {
        ...details.requestHeaders,
        'User-Agent': TILE_USER_AGENT,
      };
      delete headers.Referer;
      delete headers.referer;
      callback({ requestHeaders: headers });
    },
  );
}

interface SaveRequest {
  content: string;
  path?: string;
  suggestedName?: string;
}

type OpenEvent = { file: ProjectFile } | { error: string };

let mainWindow: BrowserWindow | null = null;
let rendererReady = false;
let pendingOpenPath: string | undefined;

function sendOpenEvent(event: OpenEvent): void {
  if (!mainWindow || !rendererReady) return;
  mainWindow.webContents.send('project:open-path', event);
}

async function deliverOpenPath(filePath: string): Promise<void> {
  pendingOpenPath = filePath;
  if (!rendererReady) return;
  pendingOpenPath = undefined;
  try {
    sendOpenEvent({ file: await readProjectFile(filePath) });
  } catch (error) {
    sendOpenEvent({ error: error instanceof Error ? error.message : String(error) });
  }
}

function queueOpenPath(filePath: string): void {
  if (isProjectPath(filePath)) void deliverOpenPath(filePath);
}

function registerIpc(): void {
  ipcMain.handle('project:open', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: OPEN_FILTERS,
    });
    const selected = result.filePaths[0];
    if (result.canceled || !selected) return null;
    return readProjectFile(selected);
  });

  ipcMain.handle('project:save', async (_event, request: SaveRequest) => {
    if (typeof request?.content !== 'string') throw new Error('There is no project data to save.');

    const target = saveTarget(request);
    let writePath = target.writePath;
    if (!writePath) {
      const result = await dialog.showSaveDialog({
        defaultPath: target.suggestedPath,
        filters: SAVE_FILTERS,
      });
      if (result.canceled || !result.filePath) return null;
      writePath = ensureNolliExtension(result.filePath);
    }
    return writeProjectFile(writePath, request.content);
  });

  ipcMain.on('project:renderer-ready', () => {
    rendererReady = true;
    if (pendingOpenPath) void deliverOpenPath(pendingOpenPath);
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#ededf0',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
  });
  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false;
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const devURL =
    process.env.NOLLI_DEV_URL ??
    (process.argv.includes('--dev') ? 'http://127.0.0.1:5173' : undefined);
  if (devURL) {
    void mainWindow.loadURL(devURL);
  } else {
    // Packaged builds carry the editor beside the app (see `extraResources` in package.json);
    // from a checkout it sits in the editor's build folder.
    const page = app.isPackaged
      ? path.join(process.resourcesPath, 'editor', 'index.html')
      : path.join(__dirname, '../../editor/dist/index.html');
    void mainWindow.loadFile(page);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const filePath = argv.find(isProjectPath);
    if (filePath) queueOpenPath(filePath);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    queueOpenPath(filePath);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  void app.whenReady().then(() => {
    registerIpc();
    configureTileRequests();
    createWindow();
    const initialPath = process.argv.slice(1).find(isProjectPath);
    if (initialPath) queueOpenPath(initialPath);
  });
}
