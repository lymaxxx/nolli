import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureNolliExtension,
  isNolliPath,
  isProjectPath,
  nolliName,
  readProjectFile,
  saveTarget,
  writeProjectFile,
} from './fileService';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'nolli-file-test-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('project filenames', () => {
  it('recognises both extensions without regard to case', () => {
    expect(isProjectPath('Map.nolli')).toBe(true);
    expect(isProjectPath('Map.MAPCRAFT')).toBe(true);
    expect(isProjectPath('Map.json')).toBe(false);
    expect(isProjectPath('Map')).toBe(false);
    expect(isNolliPath('Map.nolli')).toBe(true);
    expect(isNolliPath('Map.mapcraft')).toBe(false);
  });

  it('always suggests a .nolli name for saving', () => {
    expect(nolliName('Map.mapcraft')).toBe('Map.nolli');
    expect(nolliName('Map.nolli')).toBe('Map.nolli');
    expect(nolliName('Untitled')).toBe('Untitled.nolli');
    expect(ensureNolliExtension('/tmp/Map')).toBe('/tmp/Map.nolli');
    expect(ensureNolliExtension('/tmp/Map.nolli')).toBe('/tmp/Map.nolli');
  });

  it('writes a saved .nolli in place but suggests a sibling for a legacy file', () => {
    expect(saveTarget({ path: '/tmp/Map.nolli' })).toEqual({
      writePath: '/tmp/Map.nolli',
      suggestedPath: '/tmp/Map.nolli',
    });
    expect(saveTarget({ path: '/tmp/Map.mapcraft' })).toEqual({
      suggestedPath: '/tmp/Map.nolli',
    });
    expect(saveTarget({ suggestedName: 'Untitled.nolli' })).toEqual({
      suggestedPath: 'Untitled.nolli',
    });
    expect(saveTarget({ suggestedName: 'Untitled' })).toEqual({
      suggestedPath: 'Untitled.nolli',
    });
  });
});

describe('project files on disk', () => {
  it('reads legacy extensions by content and writes .nolli', async () => {
    const legacyPath = path.join(directory, 'Map.mapcraft');
    await writeFile(legacyPath, '{"version":6}', 'utf8');

    const opened = await readProjectFile(legacyPath);
    expect(opened).toEqual({
      path: legacyPath,
      name: 'Map.mapcraft',
      content: '{"version":6}',
    });

    const savedPath = ensureNolliExtension(path.join(directory, 'Map'));
    await writeProjectFile(savedPath, '{"version":7}');
    expect(await readFile(savedPath, 'utf8')).toBe('{"version":7}');
  });

  it('refuses to save under a legacy extension', async () => {
    await expect(
      writeProjectFile(path.join(directory, 'Map.mapcraft'), '{"version":7}'),
    ).rejects.toThrow('.nolli');
  });
});
