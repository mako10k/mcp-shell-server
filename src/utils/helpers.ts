import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';

// ID生成
export function generateId(): string {
  return uuidv4();
}

// タイムスタンプ生成
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

// ファイルパスの検証
export function isValidPath(filePath: string, allowedPaths?: string[]): boolean {
  try {
    const resolvedPath = path.resolve(filePath);

    // 基本的なセキュリティチェック
    if (resolvedPath.includes('..')) {
      return false;
    }

    // 許可されたパスのチェック
    if (allowedPaths && allowedPaths.length > 0) {
      return allowedPaths.some((allowedPath) => resolvedPath.startsWith(path.resolve(allowedPath)));
    }

    return true;
  } catch {
    return false;
  }
}

// コマンドの検証
export function isValidCommand(
  command: string,
  allowedCommands?: string[],
  blockedCommands?: string[]
): boolean {
  const commandName = command.trim().split(/\s+/)[0];

  if (!commandName) {
    return false;
  }

  // ブロックされたコマンドのチェック
  if (blockedCommands?.includes(commandName)) {
    return false;
  }

  // 許可されたコマンドのチェック
  if (allowedCommands && allowedCommands.length > 0) {
    return allowedCommands.includes(commandName);
  }

  // デフォルトで危険なコマンドをブロック
  const dangerousCommands = [
    'rm',
    'rmdir',
    'del',
    'format',
    'fdisk',
    'mkfs',
    'shutdown',
    'reboot',
    'halt',
    'poweroff',
    'sudo',
    'su',
    'chmod',
    'chown',
    'iptables',
    'ufw',
    'firewall-cmd',
  ];

  return !dangerousCommands.includes(commandName);
}

// ファイルサイズの取得
export async function getFileSize(filePath: string): Promise<number> {
  try {
    const stats = await fs.stat(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

// ディレクトリの作成
export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

// ディレクトリの作成（同期版）
export function ensureDirectorySync(dirPath: string): void {
  try {
    fsSync.accessSync(dirPath);
  } catch {
    fsSync.mkdirSync(dirPath, { recursive: true });
  }
}

// ファイルの安全な読み取り
export async function safeReadFile(
  filePath: string,
  offset: number = 0,
  size?: number,
  encoding: BufferEncoding = 'utf-8'
): Promise<{ content: string; totalSize: number; isTruncated: boolean }> {
  const stats = await fs.stat(filePath);
  const totalSize = stats.size;

  const fileHandle = await fs.open(filePath, 'r');
  try {
    const readSize = size ? Math.min(size, totalSize - offset) : totalSize - offset;
    const buffer = Buffer.alloc(readSize);

    await fileHandle.read(buffer, 0, readSize, offset);
    const content = buffer.toString(encoding);
    const isTruncated = size ? totalSize > offset + size : false;

    return { content, totalSize, isTruncated };
  } finally {
    await fileHandle.close();
  }
}

// システム情報の取得
export function getSystemInfo() {
  return {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    loadavg: os.loadavg(),
    totalmem: os.totalmem(),
    freemem: os.freemem(),
    uptime: os.uptime(),
  };
}

// プロセス情報の取得
export function getProcessInfo() {
  return {
    pid: process.pid,
    ppid: process.ppid,
    platform: process.platform,
    arch: process.arch,
    version: process.version,
    memoryUsage: process.memoryUsage(),
    cpuUsage: process.cpuUsage(),
    uptime: process.uptime(),
  };
}

// 安全な実行環境の設定
export function getSafeEnvironment(
  baseEnv: Record<string, string> = {},
  additionalEnv: Record<string, string> = {}
): Record<string, string> {
  // 基本的な環境変数のみを許可
  const safeBaseEnv = {
    PATH: process.env['PATH'] || '',
    HOME: process.env['HOME'] || '',
    USER: process.env['USER'] || '',
    SHELL: process.env['SHELL'] || '/bin/bash',
    TERM: process.env['TERM'] || 'xterm-256color',
    LANG: process.env['LANG'] || 'en_US.UTF-8',
    TZ: process.env['TZ'] || 'UTC',
  };

  return {
    ...safeBaseEnv,
    ...baseEnv,
    ...additionalEnv,
  };
}

// 文字列のサニタイゼーション
export function sanitizeString(input: string, maxLength: number = 1000): string {
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // 制御文字を削除
    .substring(0, maxLength);
}

// バイト数のフォーマット
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 実行時間のフォーマット
export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${milliseconds}ms`;
  }

  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// ログレベル
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

// ログエントリ
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
  component?: string;
}

// 内部ログストレージ
const logEntries: LogEntry[] = [];
const MAX_LOG_ENTRIES = 1000;

// ログ機能（標準出力に書き込まない）
export function internalLog(
  level: LogLevel,
  message: string,
  data?: unknown,
  component?: string
): void {
  const entry: LogEntry = {
    timestamp: getCurrentTimestamp(),
    level,
    message,
  };

  if (data !== undefined) {
    entry.data = data;
  }

  if (component !== undefined) {
    entry.component = component;
  }

  logEntries.push(entry);

  // 古いログエントリを削除
  if (logEntries.length > MAX_LOG_ENTRIES) {
    logEntries.shift();
  }
}

// ログ取得機能
export function getLogEntries(level?: LogLevel, component?: string, limit?: number): LogEntry[] {
  let filtered = logEntries;

  if (level !== undefined) {
    filtered = filtered.filter((entry) => entry.level >= level);
  }

  if (component) {
    filtered = filtered.filter((entry) => entry.component === component);
  }

  if (limit) {
    filtered = filtered.slice(-limit);
  }

  return filtered;
}

// 便利なログ関数
export const logger = {
  debug: (message: string, data?: unknown, component?: string) =>
    internalLog(LogLevel.DEBUG, message, data, component),
  info: (message: string, data?: unknown, component?: string) =>
    internalLog(LogLevel.INFO, message, data, component),
  warn: (message: string, data?: unknown, component?: string) =>
    internalLog(LogLevel.WARN, message, data, component),
  error: (message: string, data?: unknown, component?: string) =>
    internalLog(LogLevel.ERROR, message, data, component),
};
