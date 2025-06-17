import * as fs from 'fs';
import * as path from 'path';
import { SystemProcessInfo, ForegroundProcessInfo } from '../types/index.js';

export class ProcessUtils {
  private static processInfoCache = new Map<
    number,
    { info: SystemProcessInfo; timestamp: number }
  >();
  private static readonly CACHE_TTL = 1000; // 1秒のキャッシュ

  /**
   * プロセス情報を取得する
   */
  static async getProcessInfo(pid: number): Promise<SystemProcessInfo | null> {
    // キャッシュチェック
    const cached = this.processInfoCache.get(pid);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.info;
    }

    try {
      const statPath = `/proc/${pid}/stat`;
      const commPath = `/proc/${pid}/comm`;
      const exePath = `/proc/${pid}/exe`;

      // プロセスが存在するかチェック
      if (!fs.existsSync(statPath)) {
        return null;
      }

      // /proc/{pid}/stat からセッション情報を取得
      const statContent = fs.readFileSync(statPath, 'utf8');
      const statFields = statContent.split(' ');

      if (statFields.length < 22) {
        return null;
      }

      const sessionId = parseInt(statFields[5] || '0');
      const parentPid = parseInt(statFields[3] || '0');

      // プロセス名を取得
      let name = 'unknown';
      try {
        name = fs.readFileSync(commPath, 'utf8').trim();
      } catch {
        // fallback: stat からプロセス名を抽出
        const procName = statFields[1];
        if (procName) {
          const commMatch = procName.match(/^\((.+)\)$/);
          if (commMatch && commMatch[1]) {
            name = commMatch[1];
          }
        }
      }

      // フルパスを取得（シンボリックリンクを解決）
      let fullPath: string | undefined;
      try {
        fullPath = fs.readlinkSync(exePath);
      } catch {
        // パスが取得できない場合は undefined
      }

      const processInfo: SystemProcessInfo = {
        pid,
        name,
        isSessionLeader: sessionId === pid,
      };

      // オプショナルプロパティを追加
      if (fullPath) {
        processInfo.path = fullPath;
      }
      if (sessionId > 0) {
        processInfo.sessionId = sessionId;
      }
      if (parentPid > 0) {
        processInfo.parentPid = parentPid;
      }

      // キャッシュに保存
      this.processInfoCache.set(pid, {
        info: processInfo,
        timestamp: Date.now(),
      });

      return processInfo;
    } catch (error) {
      console.error(`Failed to get process info for PID ${pid}:`, error);
      return null;
    }
  }

  /**
   * ターミナルのフォアグラウンドプロセスを取得する
   */
  static async getForegroundProcess(terminalPty: any): Promise<ForegroundProcessInfo> {
    try {
      // pty の file descriptor を取得
      const fd = terminalPty._fd || terminalPty.fd;
      if (!fd) {
        return {
          available: false,
          error: 'PTY file descriptor not available',
        };
      }

      // tcgetpgrp() の代替として /proc/tty/drivers を使用
      // まず、pty のデバイス番号を特定
      let foregroundPid: number | null = null;

      try {
        // より直接的なアプローチ: pty のプロセスグループを探す
        const ptyProcess = terminalPty.pid;
        if (ptyProcess) {
          // 子プロセスを探して、最も最近作成されたものをフォアグラウンドとみなす
          foregroundPid = await this.findLatestChildProcess(ptyProcess);
        }
      } catch (error) {
        console.error('Failed to get foreground process:', error);
      }

      if (!foregroundPid) {
        return {
          available: false,
          error: 'Could not determine foreground process',
        };
      }

      const processInfo = await this.getProcessInfo(foregroundPid);
      if (!processInfo) {
        return {
          available: false,
          error: `Process ${foregroundPid} not found`,
        };
      }

      return {
        process: processInfo,
        available: true,
      };
    } catch (error) {
      return {
        available: false,
        error: `Error getting foreground process: ${error}`,
      };
    }
  }

  /**
   * 指定されたPIDの最新の子プロセスを見つける
   */
  private static async findLatestChildProcess(parentPid: number): Promise<number | null> {
    try {
      const procDir = '/proc';
      const entries = fs.readdirSync(procDir);

      let latestChild: { pid: number; startTime: number } | null = null;

      for (const entry of entries) {
        const pid = parseInt(entry);
        if (isNaN(pid)) continue;

        try {
          const statPath = path.join(procDir, entry, 'stat');
          const statContent = fs.readFileSync(statPath, 'utf8');
          const statFields = statContent.split(' ');

          if (statFields.length < 22) continue;

          const ppid = parseInt(statFields[3] || '0');
          if (ppid === parentPid) {
            // 子プロセス発見
            const startTime = parseInt(statFields[21] || '0');
            if (!latestChild || startTime > latestChild.startTime) {
              latestChild = { pid, startTime };
            }
          }
        } catch {
          // このプロセスはスキップ
          continue;
        }
      }

      return latestChild ? latestChild.pid : null;
    } catch (error) {
      console.error('Error finding child processes:', error);
      return null;
    }
  }

  /**
   * プログラムガードの条件をチェックする
   */
  static checkProgramGuard(processInfo: SystemProcessInfo | undefined, sendTo: string): boolean {
    if (sendTo === '*') {
      return true; // 条件なし
    }

    if (!processInfo) {
      return false; // プロセス情報がない場合は拒否
    }

    // セッションリーダーチェック
    if (sendTo === 'sessionleader:' || sendTo === 'loginshell:') {
      return processInfo.isSessionLeader;
    }

    // PIDチェック
    if (sendTo.startsWith('pid:')) {
      const targetPid = parseInt(sendTo.substring(4));
      return processInfo.pid === targetPid;
    }

    // フルパスチェック
    if (sendTo.startsWith('/')) {
      return processInfo.path === sendTo;
    }

    // プロセス名チェック
    return processInfo.name === sendTo;
  }

  /**
   * キャッシュをクリアする
   */
  static clearCache(): void {
    this.processInfoCache.clear();
  }

  /**
   * 古いキャッシュエントリを削除する
   */
  static cleanupCache(): void {
    const now = Date.now();
    for (const [pid, cached] of this.processInfoCache.entries()) {
      if (now - cached.timestamp > this.CACHE_TTL * 2) {
        this.processInfoCache.delete(pid);
      }
    }
  }
}
