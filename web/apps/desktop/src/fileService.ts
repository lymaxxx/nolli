import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Open dialogs accept both the current and the legacy project extensions. */
export const PROJECT_EXTENSIONS = ['nolli', 'mapcraft'] as const;

export const OPEN_FILTERS = [
  { name: 'Nolli project', extensions: [...PROJECT_EXTENSIONS] },
  { name: 'Nolli project', extensions: ['nolli'] },
  { name: 'Legacy MapCraft project', extensions: ['mapcraft'] },
];

export const SAVE_FILTERS = [{ name: 'Nolli project', extensions: ['nolli'] }];

export interface ProjectFile {
  path: string;
  name: string;
  content: string;
}

function extensionOf(filePath: string): string {
  return path.extname(filePath).slice(1).toLowerCase();
}

export function isProjectPath(filePath: string): boolean {
  return (PROJECT_EXTENSIONS as readonly string[]).includes(extensionOf(filePath));
}

export function isNolliPath(filePath: string): boolean {
  return extensionOf(filePath) === 'nolli';
}

/** Saving always produces a `.nolli` name, including when a legacy file was opened. */
export function nolliName(name: string): string {
  const base = path.basename(name);
  const extension = path.extname(base);
  if (extension.toLowerCase() === '.nolli') return base;
  return `${extension ? base.slice(0, -extension.length) : base}.nolli`;
}

export function ensureNolliExtension(filePath: string): string {
  return isNolliPath(filePath) ? filePath : `${filePath}.nolli`;
}

export interface SaveTarget {
  /** Present when an already-saved `.nolli` file can be overwritten without a dialog. */
  writePath?: string;
  suggestedPath: string;
}

/** Open a legacy file, then suggest its `.nolli` sibling; never overwrite the legacy file. */
export function saveTarget(request: { path?: string; suggestedName?: string }): SaveTarget {
  if (request.path && isNolliPath(request.path)) {
    return { writePath: request.path, suggestedPath: request.path };
  }
  const suggestedPath = request.path
    ? path.join(path.dirname(request.path), nolliName(request.path))
    : ensureNolliExtension(request.suggestedName ?? 'Untitled.nolli');
  return { suggestedPath };
}

export async function readProjectFile(filePath: string): Promise<ProjectFile> {
  return {
    path: filePath,
    name: path.basename(filePath),
    content: await readFile(filePath, 'utf8'),
  };
}

export async function writeProjectFile(
  filePath: string,
  content: string,
): Promise<{ path: string; name: string }> {
  if (!isNolliPath(filePath)) {
    throw new Error('Nolli projects are saved with the .nolli extension.');
  }
  await writeFile(filePath, content, 'utf8');
  return { path: filePath, name: path.basename(filePath) };
}
