import * as fs from 'fs/promises';
import * as path from 'path';
import { FileInfo, OutputType } from '../types/index.js';
import {
  generateId,
  getCurrentTimestamp,
  getFileSize,
  safeReadFile,
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

  /**
   * Issue #13: output_idから実行IDを取得
   */
  getExecutionIdByOutputId(outputId: string): string | undefined {
    const fileInfo = this.files.get(outputId);
    return fileInfo?.execution_id;
  }

  /**
   * Issue #15: ディレクトリサイズベースのクリーンアップ提案
   */
  async getCleanupSuggestions(options?: {
    maxSizeMB?: number;
    maxAgeHours?: number;
    includeWarnings?: boolean;
  }): Promise<{
    current_directory_size_mb: number;
    current_file_count: number;
    recommendations?: {
      warning?: string;
      suggested_action?: string;
      cleanup_candidates: string[];
      estimated_savings_mb: number;
    };
  }> {
    const maxSizeMB = options?.maxSizeMB || 50; // Default: 50MB threshold
    const maxAgeHours = options?.maxAgeHours || 24; // Default: 24 hours
    const includeWarnings = options?.includeWarnings ?? true;

    // 現在のディレクトリサイズと情報を取得
    const stats = this.getUsageStats();
    const currentSizeMB = stats.total_size_bytes / (1024 * 1024);
    const currentTime = Date.now();

    const result = {
      current_directory_size_mb: Math.round(currentSizeMB * 100) / 100,
      current_file_count: stats.total_files,
    };

    // 閾値チェックとクリーンアップ候補の特定
    if (includeWarnings && (currentSizeMB > maxSizeMB || stats.total_files > 1000)) {
      const cleanupCandidates: string[] = [];
      let estimatedSavings = 0;

      // 古いファイルを特定
      for (const [outputId, fileInfo] of this.files) {
        const fileAge = currentTime - new Date(fileInfo.created_at).getTime();
        const fileAgeHours = fileAge / (1000 * 60 * 60);

        if (fileAgeHours > maxAgeHours) {
          cleanupCandidates.push(outputId);
          estimatedSavings += fileInfo.size;
        }
      }

      // 大きなファイルも候補に追加（サイズが平均の3倍以上）
      if (cleanupCandidates.length < 10 && stats.average_file_size > 0) {
        const largeSizeThreshold = stats.average_file_size * 3;
        for (const [outputId, fileInfo] of this.files) {
          if (fileInfo.size > largeSizeThreshold && !cleanupCandidates.includes(outputId)) {
            cleanupCandidates.push(outputId);
            estimatedSavings += fileInfo.size;
          }
        }
      }

      if (cleanupCandidates.length > 0) {
        const estimatedSavingsMB = Math.round((estimatedSavings / (1024 * 1024)) * 100) / 100;
        
        let warning: string;
        if (currentSizeMB > maxSizeMB) {
          warning = `Output directory size: ${result.current_directory_size_mb}MB exceeds threshold (${maxSizeMB}MB). Consider cleanup.`;
        } else {
          warning = `High file count: ${result.current_file_count} files. Consider cleanup for better performance.`;
        }

        return {
          ...result,
          recommendations: {
            warning,
            suggested_action: 'Use delete_execution_outputs with cleanup_candidates for automatic cleanup',
            cleanup_candidates: cleanupCandidates.slice(0, 20), // Limit to top 20 candidates
            estimated_savings_mb: estimatedSavingsMB,
          },
        };
      }
    }

    return result;
  }

  /**
   * Issue #15: 年齢ベースの自動クリーンアップ
   */
  async performAutoCleanup(options?: {
    maxAgeHours?: number;
    dryRun?: boolean;
    preserveRecent?: number;
  }): Promise<{
    deleted_files: string[];
    preserved_files: string[];
    space_freed_mb: number;
    dry_run: boolean;
  }> {
    const maxAgeHours = options?.maxAgeHours || 24;
    const dryRun = options?.dryRun ?? true; // Default to dry run for safety
    const preserveRecent = options?.preserveRecent || 10; // Keep at least 10 recent files

    const currentTime = Date.now();
    const deleteCandidates: string[] = [];
    const preserveCandidates: string[] = [];
    let spaceFeed = 0;

    // ファイルを作成時間でソート（新しい順）
    const sortedFiles = Array.from(this.files.entries()).sort(
      ([, a], [, b]) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    // 最新のN個は保持、残りは年齢でチェック
    for (let i = 0; i < sortedFiles.length; i++) {
      const entry = sortedFiles[i];
      if (!entry) continue;
      
      const [outputId, fileInfo] = entry;
      
      if (i < preserveRecent) {
        // 最新のN個は保持
        preserveCandidates.push(outputId);
      } else {
        // 古いファイルかチェック
        const fileAge = currentTime - new Date(fileInfo.created_at).getTime();
        const fileAgeHours = fileAge / (1000 * 60 * 60);

        if (fileAgeHours > maxAgeHours) {
          deleteCandidates.push(outputId);
          spaceFeed += fileInfo.size;
        } else {
          preserveCandidates.push(outputId);
        }
      }
    }

    const spaceFreedMB = Math.round((spaceFeed / (1024 * 1024)) * 100) / 100;

    // 実際の削除実行（dryRunでない場合）
    if (!dryRun && deleteCandidates.length > 0) {
      try {
        await this.deleteFiles(deleteCandidates, true);
      } catch (error) {
        console.error('Auto cleanup failed:', error);
        // エラーの場合は削除されなかった扱い
        return {
          deleted_files: [],
          preserved_files: Array.from(this.files.keys()),
          space_freed_mb: 0,
          dry_run: dryRun,
        };
      }
    }

    return {
      deleted_files: deleteCandidates,
      preserved_files: preserveCandidates,
      space_freed_mb: spaceFreedMB,
      dry_run: dryRun,
    };
  }
}
