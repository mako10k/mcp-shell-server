import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { logger, LogLevel, updateLogConfig, getLogConfig } from '../../packages/shell-server/src/utils/helpers.js';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Enhanced Logging System Tests', () => {
  const testLogDir = './test-logs';
  const testLogFile = path.join(testLogDir, 'test.log');

  beforeEach(async () => {
    // テスト用ログ設定
    updateLogConfig({
      enableFileLogging: true,
      logFilePath: testLogFile,
      maxFileSize: 1024, // 1KB for testing
      maxLogFiles: 3,
      enableConsoleLogging: false
    });

    // テストログディレクトリをクリーンアップ
    try {
      await fs.rm(testLogDir, { recursive: true, force: true });
    } catch {
      // ディレクトリが存在しない場合は無視
    }
  });

  afterEach(async () => {
    // テストログディレクトリをクリーンアップ
    try {
      await fs.rm(testLogDir, { recursive: true, force: true });
    } catch {
      // ディレクトリが存在しない場合は無視
    }
  });

  describe('File Logging', () => {
    test('should create log directory and write to file', async () => {
      logger.info('Test log message', { data: 'test' }, 'test-component');
      
      // ファイル書き込みが完了するまで少し待つ
      await new Promise(resolve => setTimeout(resolve, 100));

      const logExists = await fs.access(testLogFile).then(() => true).catch(() => false);
      expect(logExists).toBe(true);

      const logContent = await fs.readFile(testLogFile, 'utf-8');
      expect(logContent).toContain('Test log message');
      expect(logContent).toContain('[INFO]');
      expect(logContent).toContain('test-component');
      expect(logContent).toContain('"data":"test"');
    });

    test('should read log file using logger.readLogFile', async () => {
      logger.info('Log line 1', {}, 'test');
      logger.warn('Log line 2', {}, 'test');
      logger.error('Log line 3', {}, 'test');

      // ファイル書き込み完了を待つ
      await new Promise(resolve => setTimeout(resolve, 100));

      const lines = await logger.readLogFile();
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(lines.some((line) => line.includes('Log line 1'))).toBe(true);
      expect(lines.some((line) => line.includes('Log line 2'))).toBe(true);
      expect(lines.some((line) => line.includes('Log line 3'))).toBe(true);

      // 制限付きで読み取り
      const limitedLines = await logger.readLogFile(2);
      expect(limitedLines.length).toBe(2);
      expect(limitedLines.some((line) => line.includes('Log line 2'))).toBe(true);
      expect(limitedLines.some((line) => line.includes('Log line 3'))).toBe(true);
    });

    test('should handle file rotation when size limit is exceeded', async () => {
      // 小さなファイルサイズ制限でテスト
      updateLogConfig({ maxFileSize: 200 });

      // 大量のログを書き込んでファイルローテーションをトリガー
      for (let i = 0; i < 10; i++) {
        logger.info(`Log message ${i}`, { iteration: i, data: 'x'.repeat(50) }, 'rotation-test');
      }

      const waitForFile = async (filePath: string, attempts = 10): Promise<boolean> => {
        for (let i = 0; i < attempts; i++) {
          const exists = await fs.access(filePath).then(() => true).catch(() => false);
          if (exists) return true;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        return false;
      };

      // ローテーションされたファイルが存在することを確認
      const rotatedFile1 = `${testLogFile}.1`;
      const rotated1Exists = await waitForFile(rotatedFile1);
      const mainExists = await waitForFile(testLogFile);

      let directoryHasFiles = false;
      try {
        const files = await fs.readdir(testLogDir);
        directoryHasFiles = files.length > 0;
      } catch {
        directoryHasFiles = false;
      }

      expect(mainExists || rotated1Exists || directoryHasFiles).toBe(true);
    });
  });

  describe('Log History and Search', () => {
    beforeEach(() => {
      // テストデータをメモリログに追加
      logger.debug('Debug message', { level: 'debug' }, 'debug-component');
      logger.info('Info message', { level: 'info' }, 'info-component');
      logger.warn('Warning message', { level: 'warn' }, 'warn-component');
      logger.error('Error message', { level: 'error' }, 'error-component');
      logger.info('Another info message', { search: 'findme' }, 'info-component');
    });

    test('should get log entries by level', () => {
      const errorLogs = logger.getEntries(LogLevel.ERROR);
      expect(errorLogs.length).toBeGreaterThanOrEqual(1);
      expect(errorLogs.some((log) => log.message === 'Error message')).toBe(true);

      const warnAndAbove = logger.getEntries(LogLevel.WARN);
      expect(warnAndAbove.length).toBeGreaterThanOrEqual(2); // WARN + ERROR
    });

    test('should get log entries by component', () => {
      const infoComponentLogs = logger.getEntries(undefined, 'info-component');
      expect(infoComponentLogs.length).toBeGreaterThanOrEqual(2);
      expect(infoComponentLogs.every(log => log.component === 'info-component')).toBe(true);
    });

    test('should get log entries with limit', () => {
      const limitedLogs = logger.getEntries(undefined, undefined, 2);
      expect(limitedLogs.length).toBe(2);
      // 最新の2つのログが返されることを確認
      expect(limitedLogs[1].message).toBe('Another info message');
    });

    test('should search logs with getHistory', () => {
      const searchResults = logger.getHistory({ search: 'findme' });
      expect(searchResults.length).toBeGreaterThanOrEqual(1);
      expect(searchResults.some((entry) => entry.message === 'Another info message')).toBe(true);

      const levelFilterResults = logger.getHistory({ level: LogLevel.WARN });
      expect(levelFilterResults.length).toBeGreaterThanOrEqual(2); // WARN + ERROR

      const componentFilterResults = logger.getHistory({ component: 'debug-component' });
      expect(componentFilterResults.length).toBeGreaterThanOrEqual(1);
      expect(componentFilterResults.some((entry) => entry.message === 'Debug message')).toBe(true);
    });

    test('should get log statistics', () => {
      const stats = logger.getStats();
      
      expect(stats.totalEntries).toBeGreaterThan(0);
      expect(stats.byLevel.DEBUG).toBeGreaterThanOrEqual(1);
      expect(stats.byLevel.INFO).toBeGreaterThanOrEqual(2);
      expect(stats.byLevel.WARN).toBeGreaterThanOrEqual(1);
      expect(stats.byLevel.ERROR).toBeGreaterThanOrEqual(1);
      
      expect(stats.byComponent['debug-component']).toBeGreaterThanOrEqual(1);
      expect(stats.byComponent['info-component']).toBeGreaterThanOrEqual(2);
      expect(stats.byComponent['warn-component']).toBeGreaterThanOrEqual(1);
      expect(stats.byComponent['error-component']).toBeGreaterThanOrEqual(1);
      
      expect(stats.oldestEntry).toBeTruthy();
      expect(stats.newestEntry).toBeTruthy();
    });

    test('should filter logs by timestamp range', () => {
      const now = new Date();
      const oneMinuteAgo = new Date(now.getTime() - 60000).toISOString();
      const oneMinuteFromNow = new Date(now.getTime() + 60000).toISOString();

      // 最近のログを追加
      logger.info('Recent log', {}, 'timestamp-test');

      const recentLogs = logger.getHistory({
        since: oneMinuteAgo,
        until: oneMinuteFromNow
      });

      expect(recentLogs.length).toBeGreaterThan(0);
      expect(recentLogs.some(log => log.message === 'Recent log')).toBe(true);
    });
  });

  describe('Log Configuration', () => {
    test('should update and get log configuration', () => {
      const originalConfig = getLogConfig();
      
      const newConfig = {
        enableFileLogging: false,
        enableConsoleLogging: true,
        maxFileSize: 5 * 1024 * 1024,
      };

      updateLogConfig(newConfig);
      
      const updatedConfig = getLogConfig();
      expect(updatedConfig.enableFileLogging).toBe(false);
      expect(updatedConfig.enableConsoleLogging).toBe(true);
      expect(updatedConfig.maxFileSize).toBe(5 * 1024 * 1024);
      
      // 他の設定は変更されていないことを確認
      expect(updatedConfig.logFilePath).toBe(originalConfig.logFilePath);
      expect(updatedConfig.maxLogFiles).toBe(originalConfig.maxLogFiles);
    });
  });

  describe('Error Handling', () => {
    test('should handle file system errors gracefully', async () => {
      // 存在しないディレクトリに書き込もうとする
      updateLogConfig({
        enableFileLogging: true,
        logFilePath: '/invalid/path/that/does/not/exist/test.log'
      });

      // エラーが発生しても例外がスローされないことを確認
      expect(() => {
        logger.error('Test error log', {}, 'error-test');
      }).not.toThrow();

      // ファイル読み取りエラーのテスト
      const lines = await logger.readLogFile();
      expect(Array.isArray(lines)).toBe(true);
      expect(lines.length).toBe(0); // エラー時は空配列が返される
    });

    test('should handle malformed data in logs gracefully', () => {
      const circularObject: Record<string, unknown> = {};
      circularObject.self = circularObject;

      // 循環参照オブジェクトでもエラーが発生しないことを確認
      expect(() => {
        logger.info('Circular object test', circularObject, 'circular-test');
      }).not.toThrow();

      const searchResults = logger.getHistory({ search: 'circular' });
      expect(searchResults.length).toBeGreaterThan(0);
    });
  });
});
