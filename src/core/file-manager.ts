import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { FileInfo, OutputType } from '../types/index.js';
import {
  generateId,
  getCurrentTimestamp,
  getFileSize,
  safeReadFile,
  ensureDirectory,
  ensureDirectorySync,
} from '../utils/helpers.js';
import { ResourceNotFoundError } from '../utils/errors.js';

export class FileManager {
  private files = new Map<string, FileInfo>();
  private readonly baseDir: string;
  private readonly maxFiles: number;

  constructor(baseDir = '/tmp/mcp-shell-files', maxFiles = 10000) {
    this.baseDir = baseDir;
    this.maxFiles = maxFiles;
    this.initializeBaseDirectorySync();
  }

  private initializeBaseDirectorySync(): void {
    ensureDirectorySync(this.baseDir);
    ensureDirectorySync(path.join(this.baseDir, 'output'));
    ensureDirectorySync(path.join(this.baseDir, 'log'));
    ensureDirectorySync(path.join(this.baseDir, 'temp'));
  }

  async registerFile(
    filePath: string,
    outputType: OutputType,
    executionId?: string,
    customName?: string
  ): Promise<string> {
    // ファイル数の制限チェック
    if (this.files.size >= this.maxFiles) {
      // 古いファイルを自動削除
      await this.cleanupOldFiles(100);
    }

    const outputId = generateId();
    const size = await getFileSize(filePath);
    const fileName = customName || path.basename(filePath);

    const fileInfo: FileInfo = {
      output_id: outputId,
      output_type: outputType,
      name: fileName,
      size,
      created_at: getCurrentTimestamp(),
      path: filePath,
    };

    if (executionId) {
      fileInfo.execution_id = executionId;
    }

    this.files.set(outputId, fileInfo);
    return outputId;
  }

  async createOutputFile(content: string, executionId?: string): Promise<string> {
    const outputId = generateId();
    const fileName = `output_${outputId}.txt`;
    const filePath = path.join(this.baseDir, 'output', fileName);

    await fs.writeFile(filePath, content, 'utf-8');

    return await this.registerFile(filePath, 'combined', executionId, fileName);
  }

  async createLogFile(content: string, executionId?: string): Promise<string> {
    const outputId = generateId();
    const fileName = `log_${outputId}.log`;
    const filePath = path.join(this.baseDir, 'log', fileName);

    await fs.writeFile(filePath, content, 'utf-8');

    return await this.registerFile(filePath, 'log', executionId, fileName);
  }

  async createTempFile(content: string, extension = '.tmp'): Promise<string> {
    const outputId = generateId();
    const fileName = `temp_${outputId}${extension}`;
    const filePath = path.join(this.baseDir, 'temp', fileName);

    await fs.writeFile(filePath, content, 'utf-8');

    return await this.registerFile(filePath, 'log', undefined, fileName);
  }

  getFile(outputId: string): FileInfo {
    const fileInfo = this.files.get(outputId);
    if (!fileInfo) {
      throw new ResourceNotFoundError('file', outputId);
    }
    return { ...fileInfo };
  }

  async readFile(
    outputId: string,
    offset = 0,
    size = 8192,
    encoding: BufferEncoding = 'utf-8'
  ): Promise<{
    output_id: string;
    content: string;
    size: number;
    total_size: number;
    is_truncated: boolean;
    encoding: string;
  }> {
    const fileInfo = this.getFile(outputId);

    try {
      const { content, totalSize, isTruncated } = await safeReadFile(
        fileInfo.path,
        offset,
        size,
        encoding
      );

      return {
        output_id: outputId,
        content,
        size: content.length,
        total_size: totalSize,
        is_truncated: isTruncated,
        encoding,
      };
    } catch (error) {
      throw new Error(`Failed to read file ${outputId}: ${error}`);
    }
  }

  listFiles(filter?: {
    outputType?: OutputType | 'all';
    executionId?: string;
    namePattern?: string;
    limit?: number;
  }): { files: FileInfo[]; total_count: number } {
    let files = Array.from(this.files.values());

    // フィルタリング
    if (filter) {
      if (filter.outputType && filter.outputType !== 'all') {
        files = files.filter((file) => file.output_type === filter.outputType);
      }

      if (filter.executionId) {
        files = files.filter((file) => file.execution_id === filter.executionId);
      }

      if (filter.namePattern) {
        const pattern = new RegExp(filter.namePattern, 'i');
        files = files.filter((file) => pattern.test(file.name));
      }
    }

    const totalCount = files.length;

    // 制限
    if (filter?.limit) {
      files = files.slice(0, filter.limit);
    }

    // 作成日時でソート（新しい順）
    files.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return {
      files: files.map((file) => ({ ...file })),
      total_count: totalCount,
    };
  }

  async deleteFiles(
    outputIds: string[],
    confirm: boolean
  ): Promise<{
    deleted_files: string[];
    failed_files: string[];
    total_deleted: number;
  }> {
    if (!confirm) {
      throw new Error('Deletion must be confirmed');
    }

    const deletedFiles: string[] = [];
    const failedFiles: string[] = [];

    for (const outputId of outputIds) {
      try {
        const fileInfo = this.files.get(outputId);
        if (!fileInfo) {
          failedFiles.push(outputId);
          continue;
        }

        // ファイルシステムからファイルを削除
        await fs.unlink(fileInfo.path);

        // マップから削除
        this.files.delete(outputId);
        deletedFiles.push(outputId);
      } catch (error) {
        // エラーログを内部ログに記録（標準出力を避ける）
        // console.error(`Failed to delete file ${outputId}:`, error);
        failedFiles.push(outputId);
      }
    }

    return {
      deleted_files: deletedFiles,
      failed_files: failedFiles,
      total_deleted: deletedFiles.length,
    };
  }

  private async cleanupOldFiles(deleteCount: number): Promise<void> {
    const files = Array.from(this.files.entries());

    // 作成日時でソート（古い順）
    files.sort(
      ([, a], [, b]) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    const filesToDelete = files.slice(0, deleteCount);

    for (const [fileId, fileInfo] of filesToDelete) {
      try {
        await fs.unlink(fileInfo.path);
        this.files.delete(fileId);
      } catch (error) {
        // エラーログを内部ログに記録（標準出力を避ける）
        // console.error(`Failed to cleanup file ${fileId}:`, error);
      }
    }
  }

  // 実行IDに関連するファイルを削除
  async deleteExecutionFiles(executionId: string): Promise<number> {
    const filesToDelete = Array.from(this.files.entries())
      .filter(([, file]) => file.execution_id === executionId)
      .map(([fileId]) => fileId);

    if (filesToDelete.length === 0) {
      return 0;
    }

    const result = await this.deleteFiles(filesToDelete, true);
    return result.total_deleted;
  }

  // 使用統計の取得
  getUsageStats(): {
    total_files: number;
    files_by_type: Record<OutputType, number>;
    total_size_bytes: number;
    average_file_size: number;
  } {
    const files = Array.from(this.files.values());
    const totalFiles = files.length;

    const filesByType: Record<OutputType, number> = {
      stdout: 0,
      stderr: 0,
      combined: 0,
      log: 0,
      all: 0,
    };

    let totalSize = 0;

    for (const file of files) {
      if (file.output_type !== 'all') {
        filesByType[file.output_type]++;
      }
      totalSize += file.size;
    }

    return {
      total_files: totalFiles,
      files_by_type: filesByType,
      total_size_bytes: totalSize,
      average_file_size: totalFiles > 0 ? totalSize / totalFiles : 0,
    };
  }

  async cleanup(): Promise<void> {
    // 全てのファイルを削除
    const allOutputIds = Array.from(this.files.keys());

    try {
      await this.deleteFiles(allOutputIds, true);
    } catch (error) {
      // エラーログを内部ログに記録（標準出力を避ける）
      // console.error('Failed to cleanup files:', error);
    }

    this.files.clear();
  }
}
