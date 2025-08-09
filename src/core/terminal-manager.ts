import * as pty from 'node-pty';
import {
  TerminalInfo,
  ShellType,
  TerminalStatus,
  Dimensions,
  EnvironmentVariables,
  ForegroundProcessInfo,
} from '../types/index.js';
import { generateId, getCurrentTimestamp, getSafeEnvironment } from '../utils/helpers.js';
import { ResourceNotFoundError, ResourceLimitError, ExecutionError } from '../utils/errors.js';
import { ProcessUtils } from '../utils/process-utils.js';

interface TerminalOutputResult {
  output: string;
  line_count: number;
  total_lines: number;
  has_more: boolean;
  start_line: number;
  next_start_line: number;
  foreground_process?: ForegroundProcessInfo | undefined;
}

export interface TerminalOptions {
  sessionName?: string | undefined;
  shellType: ShellType;
  dimensions: Dimensions;
  workingDirectory?: string | undefined;
  environmentVariables?: EnvironmentVariables | undefined;
  autoSaveHistory: boolean;
}

interface TerminalSession {
  info: TerminalInfo;
  ptyProcess: pty.IPty;
  outputBuffer: string[];
  history: string[];
  lastActivity: Date;
  foregroundProcessCache?: { info: ForegroundProcessInfo; timestamp: number };
}

export class TerminalManager {
  private terminals = new Map<string, TerminalSession>();
  private terminalReadPositions = new Map<string, number>(); // Track last read position for each terminal
  private readonly maxTerminals: number;
  private readonly maxOutputLines: number;
  private readonly maxHistoryLines: number;

  constructor(maxTerminals = 20, maxOutputLines = 10000, maxHistoryLines = 1000) {
    this.maxTerminals = maxTerminals;
    this.maxOutputLines = maxOutputLines;
    this.maxHistoryLines = maxHistoryLines;
  }

  async createTerminal(options: TerminalOptions): Promise<TerminalInfo> {
    // ターミナル数の制限チェック
    if (this.terminals.size >= this.maxTerminals) {
      throw new ResourceLimitError('terminals', this.maxTerminals);
    }

    const terminalId = generateId();
    const now = getCurrentTimestamp();

    // デフォルト値の設定
    const shellType = options.shellType || 'bash';
    const dimensions = options.dimensions || { width: 80, height: 24 };

    // シェルコマンドの決定
    const shellCommand = this.getShellCommand(shellType);

    // 環境変数の準備
    const env = getSafeEnvironment(
      process.env as Record<string, string>,
      options.environmentVariables
    );

    try {
      // PTYプロセスの作成
      const ptyProcess = pty.spawn(shellCommand.command, shellCommand.args, {
        name: 'xterm-256color',
        cols: dimensions.width,
        rows: dimensions.height,
        cwd: options.workingDirectory || process.cwd(),
        env,
      });

      // ターミナル情報の作成
      const terminalInfo: TerminalInfo = {
        terminal_id: terminalId,
        session_name: options.sessionName || `terminal-${terminalId.slice(0, 8)}`,
        shell_type: shellType,
        dimensions: dimensions,
        process_id: ptyProcess.pid,
        status: 'active',
        working_directory: options.workingDirectory || process.cwd(),
        created_at: now,
        last_activity: now,
        foreground_process: {
          available: false,
          error: 'Not yet determined',
        },
      };

      // ターミナルセッションの初期化
      const session: TerminalSession = {
        info: terminalInfo,
        ptyProcess,
        outputBuffer: [],
        history: [],
        lastActivity: new Date(),
      };

      // 出力の処理
      ptyProcess.onData((data) => {
        this.handleOutput(terminalId, data);
      });

      // プロセス終了の処理
      ptyProcess.onExit((exitCode) => {
        this.handleTerminalExit(terminalId, exitCode);
      });

      this.terminals.set(terminalId, session);
      return terminalInfo;
    } catch (error) {
      throw new ExecutionError(`Failed to create terminal: ${error}`, {
        shellType: shellType,
        error: String(error),
      });
    }
  }

  private getShellCommand(shellType: ShellType): { command: string; args: string[] } {
    switch (shellType) {
      case 'bash':
        return { command: '/bin/bash', args: ['--login'] };
      case 'zsh':
        return { command: '/bin/zsh', args: ['--login'] };
      case 'fish':
        return { command: '/usr/bin/fish', args: ['--login'] };
      case 'cmd':
        return { command: 'cmd.exe', args: [] };
      case 'powershell':
        return { command: 'powershell.exe', args: ['-NoLogo'] };
      default:
        return { command: '/bin/bash', args: ['--login'] };
    }
  }

  private handleOutput(terminalId: string, data: string): void {
    const session = this.terminals.get(terminalId);
    if (!session) return;

    // 出力をバッファに追加
    const lines = data.split('\n');
    session.outputBuffer.push(...lines);

    // バッファサイズの制限
    if (session.outputBuffer.length > this.maxOutputLines) {
      session.outputBuffer = session.outputBuffer.slice(-this.maxOutputLines);
    }

    // 最終活動時刻の更新
    session.lastActivity = new Date();
    session.info.last_activity = getCurrentTimestamp();
    session.info.status = 'active';
  }

  private handleTerminalExit(
    terminalId: string,
    _exitCode: { exitCode: number; signal?: number }
  ): void {
    const session = this.terminals.get(terminalId);
    if (!session) return;

    session.info.status = 'closed';
    session.info.last_activity = getCurrentTimestamp();

    // 一定時間後にセッションをクリーンアップ
    setTimeout(() => {
      this.terminals.delete(terminalId);
    }, 30000); // 30秒後
  }

  async getTerminal(terminalId: string, updateForegroundProcess = true): Promise<TerminalInfo> {
    const session = this.terminals.get(terminalId);
    if (!session) {
      throw new ResourceNotFoundError('terminal', terminalId);
    }

    // フォアグラウンドプロセス情報を更新
    if (updateForegroundProcess) {
      await this.updateForegroundProcess(session);
    }

    return { ...session.info };
  }

  listTerminals(filter?: {
    sessionNamePattern?: string;
    statusFilter?: TerminalStatus | 'all';
    limit?: number;
  }): { terminals: TerminalInfo[]; total: number } {
    let terminals = Array.from(this.terminals.values()).map((session) => ({ ...session.info }));

    // フィルタリング
    if (filter) {
      if (filter.sessionNamePattern) {
        const pattern = new RegExp(filter.sessionNamePattern, 'i');
        terminals = terminals.filter((terminal) => pattern.test(terminal.session_name || ''));
      }

      if (filter.statusFilter && filter.statusFilter !== 'all') {
        terminals = terminals.filter((terminal) => terminal.status === filter.statusFilter);
      }
    }

    const total = terminals.length;

    // 制限
    if (filter?.limit) {
      terminals = terminals.slice(0, filter.limit);
    }

    return { terminals, total };
  }

  async sendInput(
    terminalId: string,
    input: string,
    execute = false,
    controlCodes = false,
    rawBytes = false,
    sendTo?: string
  ): Promise<{
    success: boolean;
    timestamp: string;
    guard_check?: { passed: boolean; target?: string };
  }> {
    const session = this.terminals.get(terminalId);
    if (!session) {
      throw new ResourceNotFoundError('terminal', terminalId);
    }

    if (session.info.status === 'closed') {
      throw new ExecutionError('Terminal is closed');
    }

    // プログラムガードチェック
    let guardResult: { passed: boolean; target?: string } | undefined;
    if (sendTo) {
      const guardPassed = await this.checkProgramGuard(terminalId, sendTo);
      guardResult = { passed: guardPassed, target: sendTo };

      if (!guardPassed) {
        throw new ExecutionError(`Program guard failed: input rejected for target "${sendTo}"`);
      }
    }

    try {
      let inputToSend: string;

      if (rawBytes) {
        // バイト列として送信（16進数文字列として受け取った場合）
        try {
          const bytes = Buffer.from(input, 'hex');
          inputToSend = bytes.toString('binary');
        } catch (error) {
          throw new ExecutionError('Invalid hex string for raw_bytes mode');
        }
      } else if (controlCodes) {
        // 制御コードのエスケープシーケンスを解釈
        inputToSend = this.parseControlCodes(input);
        if (execute) {
          inputToSend += '\r';
        }
      } else {
        // 通常の入力
        inputToSend = execute ? `${input}\r` : input;
      }

      session.ptyProcess.write(inputToSend);

      // 履歴に追加（executeの場合のみ、制御コードは除く）
      if (execute && input.trim() && !controlCodes && !rawBytes) {
        session.history.push(input.trim());
        if (session.history.length > this.maxHistoryLines) {
          session.history = session.history.slice(-this.maxHistoryLines);
        }
      }

      // 活動時刻の更新
      session.lastActivity = new Date();
      session.info.last_activity = getCurrentTimestamp();

      // フォアグラウンドプロセス情報を非同期で更新（パフォーマンスのため）
      this.updateForegroundProcess(session).catch((err) => {
        console.warn(`Failed to update foreground process for terminal ${terminalId}:`, err);
      });

      const result = {
        success: true,
        timestamp: getCurrentTimestamp(),
      } as {
        success: boolean;
        timestamp: string;
        guard_check?: { passed: boolean; target?: string };
      };

      if (guardResult) {
        result.guard_check = guardResult;
      }

      return result;
    } catch (error) {
      throw new ExecutionError(`Failed to send input: ${error}`);
    }
  }

  /**
   * 制御コードのエスケープシーケンスを解釈する
   */
  private parseControlCodes(input: string): string {
    return (
      input
        // 一般的な制御文字
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\b/g, '\b')
        .replace(/\\f/g, '\f')
        .replace(/\\v/g, '\v')
        .replace(/\\0/g, '\0')
        // Ctrl+文字のシーケンス (^C = Ctrl+C)
        .replace(/\^([A-Z@\[\]\\^_])/g, (_, char) => {
          const code = char.charCodeAt(0);
          if (code >= 64 && code <= 95) {
            // @ to _
            return String.fromCharCode(code - 64);
          }
          return `^${char}`;
        })
        // 16進数エスケープ (\x1b)
        .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => {
          return String.fromCharCode(parseInt(hex, 16));
        })
        // 8進数エスケープ (\033)
        .replace(/\\([0-7]{3})/g, (_, octal) => {
          return String.fromCharCode(parseInt(octal, 8));
        })
        // Unicode エスケープ (\u001b)
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, unicode) => {
          return String.fromCharCode(parseInt(unicode, 16));
        })
        // エスケープされたバックスラッシュ
        .replace(/\\\\/g, '\\')
    );
  }

  async getOutput(
    terminalId: string,
    startLine?: number,
    lineCount = 100,
    includeAnsi = false,
    includeForegroundProcess = false
  ): Promise<{
    output: string;
    line_count: number;
    total_lines: number;
    has_more: boolean;
    start_line: number;
    next_start_line: number;
    foreground_process?: ForegroundProcessInfo | undefined;
  }> {
    const session = this.terminals.get(terminalId);
    if (!session) {
      throw new ResourceNotFoundError('terminal', terminalId);
    }

    // startLineが指定されていない場合は、前回の読み取り位置を使用
    const actualStartLine = startLine !== undefined 
      ? startLine 
      : (this.terminalReadPositions.get(terminalId) || 0);

    // フォアグラウンドプロセス情報を更新（要求された場合）
    if (includeForegroundProcess) {
      await this.updateForegroundProcess(session);
    }

    const totalLines = session.outputBuffer.length;
    const endLine = Math.min(actualStartLine + lineCount, totalLines);
    const outputLines = session.outputBuffer.slice(actualStartLine, endLine);

    let output = outputLines.join('\n');

    // ANSI制御コードの除去（オプション）
    if (!includeAnsi) {
      output = this.stripAnsiCodes(output);
    }

    // 次回の読み取り位置を更新
    const nextStartLine = endLine;
    this.terminalReadPositions.set(terminalId, nextStartLine);

  const result: TerminalOutputResult = {
      output,
      line_count: outputLines.length,
      total_lines: totalLines,
      has_more: endLine < totalLines,
      start_line: actualStartLine,
      next_start_line: nextStartLine,
    };

    if (includeForegroundProcess) {
      result.foreground_process = session.info.foreground_process;
    }

    return result;
  }

  private stripAnsiCodes(text: string): string {
    // ANSI制御コードを除去する正規表現
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  }

  /**
   * Reset the read position for a terminal to start reading from the beginning again
   */
  resetReadPosition(terminalId: string): { success: boolean; reset_to: number } {
    const session = this.terminals.get(terminalId);
    if (!session) {
      throw new ResourceNotFoundError('terminal', terminalId);
    }

    this.terminalReadPositions.set(terminalId, 0);
    return {
      success: true,
      reset_to: 0,
    };
  }

  /**
   * Set the read position for a terminal to a specific line
   */
  setReadPosition(terminalId: string, position: number): { success: boolean; set_to: number } {
    const session = this.terminals.get(terminalId);
    if (!session) {
      throw new ResourceNotFoundError('terminal', terminalId);
    }

    const clampedPosition = Math.max(0, Math.min(position, session.outputBuffer.length));
    this.terminalReadPositions.set(terminalId, clampedPosition);
    return {
      success: true,
      set_to: clampedPosition,
    };
  }

  /**
   * Get the current read position for a terminal
   */
  getReadPosition(terminalId: string): { current_position: number; total_lines: number } {
    const session = this.terminals.get(terminalId);
    if (!session) {
      throw new ResourceNotFoundError('terminal', terminalId);
    }

    const currentPosition = this.terminalReadPositions.get(terminalId) || 0;
    return {
      current_position: currentPosition,
      total_lines: session.outputBuffer.length,
    };
  }

  resizeTerminal(
    terminalId: string,
    dimensions: Dimensions
  ): { success: boolean; updated_at: string } {
    const session = this.terminals.get(terminalId);
    if (!session) {
      throw new ResourceNotFoundError('terminal', terminalId);
    }

    if (session.info.status === 'closed') {
      throw new ExecutionError('Terminal is closed');
    }

    try {
      // PTYのサイズを変更
      session.ptyProcess.resize(dimensions.width, dimensions.height);

      // 情報を更新
      session.info.dimensions = dimensions;
      session.info.last_activity = getCurrentTimestamp();

      return {
        success: true,
        updated_at: session.info.last_activity,
      };
    } catch (error) {
      throw new ExecutionError(`Failed to resize terminal: ${error}`);
    }
  }

  closeTerminal(
    terminalId: string,
    saveHistory = true
  ): {
    success: boolean;
    history_saved: boolean;
    closed_at: string;
  } {
    const session = this.terminals.get(terminalId);
    if (!session) {
      throw new ResourceNotFoundError('terminal', terminalId);
    }

    const closedAt = getCurrentTimestamp();

    try {
      // PTYプロセスを終了
      session.ptyProcess.kill();

      // セッション情報を更新
      session.info.status = 'closed';
      session.info.last_activity = closedAt;

      // 履歴保存の処理（今後実装）
      const historySaved = saveHistory && session.history.length > 0;

      // セッションをマップから削除
      this.terminals.delete(terminalId);
      
      // 読み取り位置もクリーンアップ
      this.terminalReadPositions.delete(terminalId);

      return {
        success: true,
        history_saved: historySaved,
        closed_at: closedAt,
      };
    } catch (error) {
      throw new ExecutionError(`Failed to close terminal: ${error}`);
    }
  }

  // アイドル状態のターミナルの検出
  getIdleTerminals(idleMinutes = 30): string[] {
    const now = new Date();
    const idleThreshold = idleMinutes * 60 * 1000; // ミリ秒に変換

    const idleTerminals: string[] = [];

    for (const [terminalId, session] of this.terminals) {
      if (session.info.status === 'active') {
        const lastActivity = session.lastActivity.getTime();
        if (now.getTime() - lastActivity > idleThreshold) {
          session.info.status = 'idle';
          idleTerminals.push(terminalId);
        }
      }
    }

    return idleTerminals;
  }

  cleanup(): void {
    // 全てのターミナルを閉じる
    for (const [terminalId] of this.terminals) {
      try {
        this.closeTerminal(terminalId, false);
      } catch (error) {
        // エラーログを内部ログに記録（標準出力を避ける）
        // console.error(`Failed to cleanup terminal ${terminalId}:`, error);
      }
    }

    this.terminals.clear();
  }

  /**
   * フォアグラウンドプロセス情報を更新する
   */
  private async updateForegroundProcess(session: TerminalSession): Promise<void> {
    try {
      // キャッシュチェック（5秒間有効）
      const now = Date.now();
      if (session.foregroundProcessCache && now - session.foregroundProcessCache.timestamp < 5000) {
        session.info.foreground_process = session.foregroundProcessCache.info;
        return;
      }

      const foregroundInfo = await ProcessUtils.getForegroundProcess(session.ptyProcess);

      // キャッシュを更新
      session.foregroundProcessCache = {
        info: foregroundInfo,
        timestamp: now,
      };

      session.info.foreground_process = foregroundInfo;
    } catch (error) {
      session.info.foreground_process = {
        available: false,
        error: `Failed to update foreground process: ${error}`,
      };
    }
  }

  /**
   * プログラムガードをチェックする
   */
  private async checkProgramGuard(terminalId: string, sendTo: string): Promise<boolean> {
    if (sendTo === '*') {
      return true; // 条件なし
    }

    const session = this.terminals.get(terminalId);
    if (!session) {
      return false;
    }

    // フォアグラウンドプロセス情報を更新
    await this.updateForegroundProcess(session);

    const foregroundProcess = session.info.foreground_process;
    if (!foregroundProcess?.available || !foregroundProcess.process) {
      return false; // フォアグラウンドプロセスが取得できない場合は拒否
    }

    return ProcessUtils.checkProgramGuard(foregroundProcess.process, sendTo);
  }
}
