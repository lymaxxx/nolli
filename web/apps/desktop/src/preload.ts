import { contextBridge, ipcRenderer } from 'electron';
import type { ProjectFile } from './fileService';

interface SaveRequest {
  content: string;
  path?: string;
  suggestedName?: string;
}

interface SaveResult {
  path: string;
  name: string;
}

type OpenEvent = { file: ProjectFile } | { error: string };

const desktopApi = {
  openProject: (): Promise<ProjectFile | null> => ipcRenderer.invoke('project:open'),
  saveProject: (request: SaveRequest): Promise<SaveResult | null> =>
    ipcRenderer.invoke('project:save', request),
  onOpenProject: (callback: (event: OpenEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: OpenEvent) => callback(event);
    ipcRenderer.on('project:open-path', listener);
    return () => ipcRenderer.removeListener('project:open-path', listener);
  },
  ready: (): void => {
    ipcRenderer.send('project:renderer-ready');
  },
  platform: process.platform,
  setTitleBarTheme: (theme: 'light' | 'dark'): void => {
    ipcRenderer.send('titlebar:theme', theme);
  },
};

contextBridge.exposeInMainWorld('nolliDesktop', desktopApi);
