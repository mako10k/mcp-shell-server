import { describe, expect, it, vi } from 'vitest';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FileManager } from '../core/file-manager.js';
import { ProcessManager } from '../core/process-manager.js';

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

  it('publishes unavailable when deletion wins after replacement commit', async () => {
    const baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-shell-receipt-race-'));
    const fileManager = new FileManager(path.join(baseDir, 'files'));
    const savedAllowedWorkdirs = process.env['MCP_SHELL_ALLOWED_WORKDIRS'];
    const savedDefaultWorkdir = process.env['MCP_SHELL_DEFAULT_WORKDIR'];
    const savedStreaming = process.env['MCP_SHELL_ENABLE_STREAMING'];
    process.env['MCP_SHELL_ALLOWED_WORKDIRS'] = baseDir;
    process.env['MCP_SHELL_DEFAULT_WORKDIR'] = baseDir;
    process.env['MCP_SHELL_ENABLE_STREAMING'] = 'false';
    const processManager = new ProcessManager(
      5,
      path.join(baseDir, 'process-output'),
      fileManager,
      undefined,
      { kind: 'host' }
    );
    const originalReplace = fileManager.replaceOutputFile.bind(fileManager);
    let signalReplacementCommitted!: () => void;
    const replacementCommitted = new Promise<void>((resolve) => {
      signalReplacementCommitted = resolve;
    });
    let releaseFinalization!: () => void;
    const finalizationGate = new Promise<void>((resolve) => {
      releaseFinalization = resolve;
    });
    const replaceSpy = vi.spyOn(fileManager, 'replaceOutputFile').mockImplementation(
      async (outputId, content) => {
        await originalReplace(outputId, content);
        signalReplacementCommitted();
        await finalizationGate;
      }
    );

    try {
      const started = await processManager.executeCommand({
        command: 'printf stale; sleep 0.2; printf final',
        executionMode: 'adaptive',
        executionBoundary: { kind: 'host' },
        workingDirectory: baseDir,
        timeoutSeconds: 3,
        foregroundTimeoutSeconds: 0.05,
        maxOutputSize: 1024,
        captureStderr: true,
      });
      const outputId = started.output_id;
      expect(outputId).toBeDefined();
      if (!outputId) throw new Error('Adaptive transition did not publish output_id.');

      await replacementCommitted;
      const deletion = await fileManager.deleteFiles([outputId], true);
      expect(deletion.deleted_files).toEqual([outputId]);
      releaseFinalization();

      let completed = processManager.getExecution(started.execution_id);
      for (let attempt = 0; attempt < 100 && completed?.status === 'running'; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        completed = processManager.getExecution(started.execution_id);
      }
      expect(completed?.status).toBe('completed');
      expect(completed?.stdout).toBe('stalefinal');
      expect(completed?.output_id).toBeUndefined();
      expect(completed?.output_status).toMatchObject({
        complete: true,
        available_via_output_id: false,
      });
      await expect(fileManager.readFile(outputId)).rejects.toThrow(/not found/i);
    } finally {
      releaseFinalization();
      replaceSpy.mockRestore();
      processManager.cleanup();
      await fileManager.cleanup();
      await fsp.rm(baseDir, { recursive: true, force: true });
      if (savedAllowedWorkdirs === undefined) delete process.env['MCP_SHELL_ALLOWED_WORKDIRS'];
      else process.env['MCP_SHELL_ALLOWED_WORKDIRS'] = savedAllowedWorkdirs;
      if (savedDefaultWorkdir === undefined) delete process.env['MCP_SHELL_DEFAULT_WORKDIR'];
      else process.env['MCP_SHELL_DEFAULT_WORKDIR'] = savedDefaultWorkdir;
      if (savedStreaming === undefined) delete process.env['MCP_SHELL_ENABLE_STREAMING'];
      else process.env['MCP_SHELL_ENABLE_STREAMING'] = savedStreaming;
    }
  });

  it('reports only successful auto-cleanup deletions and freed bytes', async () => {
    const baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-shell-cleanup-result-'));
    const manager = new FileManager(baseDir);

    try {
      const deletedId = await manager.createOutputFile('a'.repeat(1024 * 1024));
      const failedId = await manager.createOutputFile('b'.repeat(2 * 1024 * 1024));
      await fsp.unlink(manager.getFile(failedId).path);

      const result = await manager.performAutoCleanup({
        maxAgeHours: -1,
        preserveRecent: -1,
        dryRun: false,
      });

      expect(result.deleted_files).toEqual([deletedId]);
      expect(result.preserved_files).toContain(failedId);
      expect(result.space_freed_mb).toBe(1);
      expect(() => manager.getFile(deletedId)).toThrow(/not found/i);
      expect(manager.getFile(failedId).output_id).toBe(failedId);
    } finally {
      await manager.cleanup();
      await fsp.rm(baseDir, { recursive: true, force: true });
    }
  });
});
