import {
  TileCache,
  tileKey,
  tileUrl,
  type RasterXYZSource,
  type TileLookup,
} from '@nolli/core';

interface TileCoord {
  z: number;
  x: number;
  y: number;
}

const DATABASE_NAME = 'nolli-tile-cache';
const STORE_NAME = 'tiles';
const DATABASE_VERSION = 1;
const MAX_MEMORY_TILES = 512;
const MAX_PENDING = 96;
const MAX_ACTIVE = 6;

let databaseRequest: Promise<IDBDatabase | null> | null = null;

/** IndexedDB survives reloads; if it is unavailable the cache stays in memory. */
function database(): Promise<IDBDatabase | null> {
  databaseRequest ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
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
  return databaseRequest;
}

async function readStored(key: string): Promise<Blob | null> {
  const db = await database();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function storeBlob(key: string, blob: Blob): void {
  void database().then((db) => {
    if (!db) return;
    try {
      db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(blob, key);
    } catch {
      // Cache writes are best-effort; drawing must never depend on them.
    }
  });
}

/**
 * Decoded tile cache with a bounded LRU, a small download queue and an
 * IndexedDB copy of the encoded tiles. The HTTP cache also applies.
 */
export class TileLoader {
  private memory = new TileCache<ImageBitmap>(MAX_MEMORY_TILES, (image) => image.close());
  private queue: TileCoord[] = [];
  private requested = new Set<string>();
  private active = 0;
  private generation = 0;

  constructor(
    private source: RasterXYZSource,
    private readonly onTile: () => void,
  ) {}

  setSource(source: RasterXYZSource): void {
    if (
      source.id === this.source.id &&
      source.urlTemplate === this.source.urlTemplate
    ) {
      this.source = source;
      return;
    }
    this.generation += 1;
    this.source = source;
    this.queue = [];
    this.requested.clear();
    this.memory.clear();
  }

  lookup(z: number, x: number, y: number): TileLookup<ImageBitmap> | null {
    return this.memory.lookupWithParent(z, x, y);
  }

  request(z: number, x: number, y: number): void {
    if (this.memory.has(z, x, y)) return;
    const key = tileKey(z, x, y);
    if (this.requested.has(key)) return;
    this.requested.add(key);
    this.queue.push({ z, x, y });
    if (this.queue.length > MAX_PENDING) {
      const dropped = this.queue.shift();
      if (dropped) this.requested.delete(tileKey(dropped.z, dropped.x, dropped.y));
    }
    this.pump();
  }

  private pump(): void {
    while (this.active < MAX_ACTIVE && this.queue.length > 0) {
      const tile = this.queue.pop()!;
      this.active += 1;
      const generation = this.generation;
      void this.load(tile, generation)
        .catch(() => {
          // A missing or blocked tile leaves the parent/background showing.
        })
        .finally(() => {
          this.active -= 1;
          this.requested.delete(tileKey(tile.z, tile.x, tile.y));
          this.pump();
        });
    }
  }

  private async load(tile: TileCoord, generation: number): Promise<void> {
    const key = tileKey(tile.z, tile.x, tile.y);
    let bitmap: ImageBitmap | null = null;

    const stored = await readStored(key);
    if (stored) {
      try {
        bitmap = await createImageBitmap(stored);
      } catch {
        bitmap = null;
      }
    }

    if (!bitmap) {
      const response = await fetch(tileUrl(this.source, tile.z, tile.x, tile.y), {
        mode: 'cors',
        credentials: 'omit',
      });
      if (!response.ok) return;
      const blob = await response.blob();
      if (blob.size === 0) return;
      storeBlob(key, blob);
      bitmap = await createImageBitmap(blob);
    }

    if (generation !== this.generation) {
      bitmap.close();
      return;
    }
    this.memory.set(tile.z, tile.x, tile.y, bitmap);
    this.onTile();
  }

  dispose(): void {
    this.generation += 1;
    this.queue = [];
    this.requested.clear();
    this.memory.clear();
  }
}
