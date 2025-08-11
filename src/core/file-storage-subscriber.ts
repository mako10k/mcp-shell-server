/**
 * Issue #13: FileManager Subscriber実装
 * 既存のFileManagerをStreamSubscriberパターンに拡張
 */

import { StreamSubscriber } from './stream-publisher.js';
import { FileManager } from './file-manager.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { generateId, getCurrentTimestamp } from '../utils/helpers.js';

/**
 * FileManager の Subscriber ラッパー
 * プロセス出力をファイルに保存するSubscriber
 */
export class FileStorageSubscriber implements StreamSubscriber {
  public readonly id: string;
  private fileStreams: Map<string, fs.FileHandle> = new Map();
  private filePaths: Map<string, { stdout: string; stderr: string }> = new Map();

  constructor(
    private fileManager: FileManager,
    private baseDir: string = '/tmp/mcp-shell-outputs'
  ) {
    this.id = `file-storage-${generateId()}`;
  }

  async onProcessStart(executionId: string, _command: string): Promise<void> {
    // 出力ファイルのパスを準備
    const timestamp = getCurrentTimestamp().replace(/[:.]/g, '-');
    const stdoutPath = path.join(this.baseDir, `${executionId}-stdout-${timestamp}.txt`);
    const stderrPath = path.join(this.baseDir, `${executionId}-stderr-${timestamp}.txt`);

    this.filePaths.set(executionId, {
      stdout: stdoutPath,
      stderr: stderrPath,
    });

    // ファイルハンドルを開く（書き込み用）
    try {
      const stdoutHandle = await fs.open(stdoutPath, 'w');
      const stderrHandle = await fs.open(stderrPath, 'w');

      this.fileStreams.set(`${executionId}-stdout`, stdoutHandle);
      this.fileStreams.set(`${executionId}-stderr`, stderrHandle);

      // FileManagerに登録（まだ0サイズ）
      await this.fileManager.registerFile(stdoutPath, 'stdout', executionId);
      await this.fileManager.registerFile(stderrPath, 'stderr', executionId);
    } catch (error) {
      console.error(
        `FileStorageSubscriber: Failed to create output files for ${executionId}:`,
        error
      );
      throw error;
    }
  }

  async onOutputData(executionId: string, data: string, isStderr: boolean = false): Promise<void> {
    const streamKey = `${executionId}-${isStderr ? 'stderr' : 'stdout'}`;
    const fileHandle = this.fileStreams.get(streamKey);

    if (fileHandle) {
      try {
        await fileHandle.write(data);
        // すぐにフラッシュして、他のプロセスからも読み取り可能にする
        await fileHandle.sync();
      } catch (error) {
        console.error(`FileStorageSubscriber: Failed to write data for ${executionId}:`, error);
      }
    }
  }

  async onProcessEnd(executionId: string, _exitCode: number | null): Promise<void> {
    // ファイルハンドルを閉じる
    const stdoutHandle = this.fileStreams.get(`${executionId}-stdout`);
    const stderrHandle = this.fileStreams.get(`${executionId}-stderr`);

    try {
      if (stdoutHandle) {
        await stdoutHandle.close();
        this.fileStreams.delete(`${executionId}-stdout`);
      }

      if (stderrHandle) {
        await stderrHandle.close();
        this.fileStreams.delete(`${executionId}-stderr`);
      }

      // FileManagerの情報を更新（最終ファイルサイズなど）
      const filePaths = this.filePaths.get(executionId);
      if (filePaths) {
        await this.updateFileManagerInfo(executionId, filePaths);
        this.filePaths.delete(executionId);
      }
    } catch (error) {
      console.error(`FileStorageSubscriber: Error closing files for ${executionId}:`, error);
    }
  }

  async onError(executionId: string, error: Error): Promise<void> {
    // エラー時もファイルを適切に閉じる
    await this.onProcessEnd(executionId, -1);

    // エラーログを stderr ファイルに書き込む
    const filePaths = this.filePaths.get(executionId);
    if (filePaths) {
      try {
        const errorMessage = `\n[ERROR] Process failed: ${error.message}\n`;
        await fs.appendFile(filePaths.stderr, errorMessage);
      } catch (writeError) {
        console.error(`FileStorageSubscriber: Failed to write error to stderr file:`, writeError);
      }
    }
  }

  /**
   * FileManagerの情報を最終的なファイルサイズで更新
   */
  private async updateFileManagerInfo(
    executionId: string,
    filePaths: { stdout: string; stderr: string }
  ): Promise<void> {
    try {
      // ファイルサイズを取得してFileManagerを更新
      // この部分は FileManager の内部実装に依存するため、
      // FileManager に updateFileSize メソッドを追加する必要があるかもしれません

      // 現在は console.error でログ出力のみ
      const stdoutStat = await fs.stat(filePaths.stdout);
      const stderrStat = await fs.stat(filePaths.stderr);

      console.error(`FileStorageSubscriber: Files updated for ${executionId}:`);
      console.error(`  stdout: ${filePaths.stdout} (${stdoutStat.size} bytes)`);
      console.error(`  stderr: ${filePaths.stderr} (${stderrStat.size} bytes)`);
    } catch (error) {
      console.error(`FileStorageSubscriber: Failed to update file info for ${executionId}:`, error);
    }
  }

  /**
   * 指定された実行の出力ファイルパスを取得
   */
  getFilePaths(executionId: string): { stdout: string; stderr: string } | undefined {
    return this.filePaths.get(executionId);
  }

  /**
   * アクティブなファイルストリーム数を取得（デバッグ用）
   */
  getActiveStreamsCount(): number {
    return this.fileStreams.size;
  }
}
