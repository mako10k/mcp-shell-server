import { describe, expect, it, vi } from 'vitest';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FileManager } from '../core/file-manager.js';

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
  };
});

describe('FileManager output operation serialization', () => {
  it('does not resurrect an output deleted during a replacement', async () => {
    const actualFs = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    const baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-shell-file-race-'));
    const manager = new FileManager(baseDir);

    try {
      const outputId = await manager.createOutputFile('stale', 'execution-id');
      const outputPath = manager.getFile(outputId).path;
      let signalReplacementStarted!: () => void;
      const replacementStarted = new Promise<void>((resolve) => {
        signalReplacementStarted = resolve;
      });
      let releaseReplacement!: () => void;
      const replacementGate = new Promise<void>((resolve) => {
        releaseReplacement = resolve;
      });

      vi.mocked(fsp.writeFile).mockImplementationOnce(async (...args) => {
        signalReplacementStarted();
        await replacementGate;
        return actualFs.writeFile(...args);
      });

      const replacement = manager.replaceOutputFile(outputId, 'replacement');
      await replacementStarted;

      let deletionSettled = false;
      const deletion = manager.deleteFiles([outputId], true).then((result) => {
        deletionSettled = true;
        return result;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(deletionSettled).toBe(false);

      releaseReplacement();
      await expect(replacement).resolves.toBeUndefined();
      await expect(deletion).resolves.toMatchObject({
        deleted_files: [outputId],
        failed_files: [],
        total_deleted: 1,
      });
      expect(() => manager.getFile(outputId)).toThrow(/not found/i);
      await expect(fsp.stat(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fsp.rm(baseDir, { recursive: true, force: true });
    }
  });
});
