import type { FontRequest } from '@nolli/core';

/** A font file the app holds for a family and face. */
export interface FontEntry {
  family: string;
  style: string;
  /** Where it came from: an installed font the browser let us read, or a file the user chose. */
  source: 'installed' | 'file';
  data: ArrayBuffer;
}

export const fontKey = (family: string, style: string): string =>
  `${family.toLowerCase()}|${style.toLowerCase()}`;

// ── Uploaded files persist between visits ───────────────────────────────────
// Font files are licensed to the user, not to Nolli. They are kept only in this
// browser's own storage and are never written into a project or the repository.

const DATABASE_NAME = 'nolli-fonts';
const STORE_NAME = 'fonts';

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDatabase().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const request = action(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

interface StoredFont {
  family: string;
  style: string;
  data: ArrayBuffer;
}

export async function loadSavedFonts(): Promise<FontEntry[]> {
  const stored = (await run('readonly', (store) => store.getAll())) as StoredFont[] | null;
  return (stored ?? []).map((font) => ({ ...font, source: 'file' as const }));
}

export async function saveFont(entry: FontEntry): Promise<void> {
  const stored: StoredFont = { family: entry.family, style: entry.style, data: entry.data };
  await run('readwrite', (store) => store.put(stored, fontKey(entry.family, entry.style)));
}

export async function deleteSavedFont(family: string, style: string): Promise<void> {
  await run('readwrite', (store) => store.delete(fontKey(family, style)));
}

// ── Installed fonts (Chromium and Electron) ─────────────────────────────────

interface LocalFontData {
  family: string;
  style: string;
  blob(): Promise<Blob>;
}

interface LocalFontWindow {
  queryLocalFonts?: () => Promise<LocalFontData[]>;
}

/** Whether this browser can list and read installed fonts (Chromium and Electron only, with permission). */
export function canReadInstalledFonts(): boolean {
  return typeof (window as unknown as LocalFontWindow).queryLocalFonts === 'function';
}

/** True when the user has already allowed font access, so it can be used without asking again. */
export async function installedFontsAllowed(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: 'local-fonts' as PermissionName });
    return status.state === 'granted';
  } catch {
    return false;
  }
}

/**
 * Reads every installed face of the families the project asks for. Reading all
 * faces of a family (not just the ones asked for) lets a missing weight fall
 * back to the nearest installed one. Must be called from a click the first time,
 * because the browser asks permission.
 */
export async function readInstalledFonts(requests: readonly FontRequest[]): Promise<FontEntry[]> {
  const query = (window as unknown as LocalFontWindow).queryLocalFonts;
  if (!query) return [];
  const wanted = new Set(requests.map((request) => request.family.toLowerCase()));
  const all = await query.call(window);
  const entries: FontEntry[] = [];
  const seen = new Set<string>();
  for (const font of all) {
    if (!wanted.has(font.family.toLowerCase())) continue;
    const key = fontKey(font.family, font.style);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      family: font.family,
      style: font.style,
      source: 'installed',
      data: await (await font.blob()).arrayBuffer(),
    });
  }
  return entries;
}
