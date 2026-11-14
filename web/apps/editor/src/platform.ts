/**
 * File access for the thin desktop shell (M2).
 *
 * Electron supplies `window.nolliDesktop` through the preload script. A plain
 * browser uses the File System Access API where it exists and an upload or
 * download otherwise. Multipart editing stays outside `core`.
 */

export interface ProjectFile {
  name: string;
  content: string;
  path?: string;
}

export interface OpenedProjectFile extends ProjectFile {
  handle?: FileSystemFileHandle;
}

export interface SavedProjectFile {
  name: string;
  path?: string;
  handle?: FileSystemFileHandle;
}

export type OpenEvent = { file: ProjectFile } | { error: string };

interface SaveRequest {
  content: string;
  path?: string;
  suggestedName?: string;
}

interface DesktopApi {
  openProject(): Promise<ProjectFile | null>;
  saveProject(request: SaveRequest): Promise<{ path: string; name: string } | null>;
  onOpenProject(callback: (event: OpenEvent) => void): () => void;
  ready(): void;
}

declare global {
  interface Window {
    nolliDesktop?: DesktopApi;
  }
}

interface FilePickerType {
  description: string;
  accept: Record<string, string[]>;
}

interface FilePickerWindow {
  showOpenFilePicker?(options?: {
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
    types?: FilePickerType[];
  }): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(options?: {
    suggestedName?: string;
    types?: FilePickerType[];
  }): Promise<FileSystemFileHandle>;
}

const PICKER_TYPES: FilePickerType[] = [
  {
    description: 'Nolli project',
    accept: { 'application/json': ['.nolli', '.mapcraft'] },
  },
];

/** Saving always produces a `.nolli` name, even from a legacy `.mapcraft` file. */
export function toNolliName(name: string): string {
  const withoutPath = name.split(/[\\/]/).pop() ?? name;
  const dot = withoutPath.lastIndexOf('.');
  if (dot <= 0) return `${withoutPath}.nolli`;
  if (withoutPath.slice(dot).toLowerCase() === '.nolli') return withoutPath;
  return `${withoutPath.slice(0, dot)}.nolli`;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function openWithInput(): Promise<OpenedProjectFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.nolli,.mapcraft,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      void file.text().then((content) => resolve({ name: file.name, content }));
    };
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export async function openProjectFile(): Promise<OpenedProjectFile | null> {
  const desktop = window.nolliDesktop;
  if (desktop) {
    const file = await desktop.openProject();
    return file ? { ...file } : null;
  }

  const picker = window as unknown as FilePickerWindow;
  if (picker.showOpenFilePicker) {
    try {
      const [handle] = await picker.showOpenFilePicker({
        multiple: false,
        types: PICKER_TYPES,
      });
      if (!handle) return null;
      const file = await handle.getFile();
      return { name: file.name, content: await file.text(), handle };
    } catch (error) {
      if (isAbort(error)) return null;
      throw error;
    }
  }

  return openWithInput();
}

/** Offers `content` to the user as a file download, in the browser or the desktop app. */
export function downloadFile(name: string, content: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  // Some browsers cancel the download if the URL is revoked at once.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function downloadProject(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function saveProjectFile(
  content: string,
  current: SavedProjectFile,
): Promise<SavedProjectFile | null> {
  const desktop = window.nolliDesktop;
  if (desktop) {
    const saved = await desktop.saveProject({
      content,
      path: current.path,
      suggestedName: toNolliName(current.name),
    });
    return saved ? { name: saved.name, path: saved.path } : null;
  }

  const name = toNolliName(current.name);
  if (current.handle && current.handle.name.toLowerCase().endsWith('.nolli')) {
    const writable = await current.handle.createWritable();
    await writable.write(content);
    await writable.close();
    return { name: current.handle.name, handle: current.handle };
  }

  const picker = window as unknown as FilePickerWindow;
  if (picker.showSaveFilePicker) {
    try {
      const handle = await picker.showSaveFilePicker({
        suggestedName: name,
        types: PICKER_TYPES,
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return { name: handle.name, handle };
    } catch (error) {
      if (isAbort(error)) return null;
      throw error;
    }
  }

  downloadProject(name, content);
  return { name };
}
