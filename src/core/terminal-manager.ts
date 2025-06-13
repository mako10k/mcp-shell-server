import * as pty from 'node-pty';
import { 
  TerminalInfo, 
  ShellType, 
  TerminalStatus, 
  Dimensions,
  EnvironmentVariables 
} from '../types/index.js';
import { 
  generateId, 
  getCurrentTimestamp, 
  getSafeEnvironment 
} from '../utils/helpers.js';
import { 
  ResourceNotFoundError,
  ResourceLimitError,
  ExecutionError 
} from '../utils/errors.js';

export interface TerminalOptions {
  sessionName?: string;
  shellType: ShellType;
  dimensions: Dimensions;
  workingDirectory?: string;
  environmentVariables?: EnvironmentVariables;
  autoSaveHistory: boolean;
}

interface TerminalSession {
  info: TerminalInfo;
  ptyProcess: pty.IPty;
  outputBuffer: string[];
  history: string[];
  lastActivity: Date;
}

export class TerminalManager {
  private terminals = new Map<string, TerminalSession>();
  private readonly maxTerminals: number;
  private readonly maxOutputLines: number;
  private readonly maxHistoryLines: number;

  constructor(
    maxTerminals = 20,
    maxOutputLines = 10000,
    maxHistoryLines = 1000
  ) {
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
      throw new ExecutionError(
        `Failed to create terminal: ${error}`,
        { shellType: shellType, error: String(error) }
      );
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

  private handleTerminalExit(terminalId: string, _exitCode: { exitCode: number; signal?: number }): void {
    const session = this.terminals.get(terminalId);
    if (!session) return;

    session.info.status = 'closed';
    session.info.last_activity = getCurrentTimestamp();

    // 一定時間後にセッションをクリーンアップ
    setTimeout(() => {
      this.terminals.delete(terminalId);
    }, 30000); // 30秒後
  }

  getTerminal(terminalId: string): TerminalInfo {
    const session = this.terminals.get(terminalId);
    if (!session) {
      throw new ResourceNotFoundError('terminal', terminalId);
    }

    return { ...session.info };
  }

  listTerminals(filter?: {
    sessionNamePattern?: string;
    statusFilter?: TerminalStatus | 'all';
    limit?: number;
  }): { terminals: TerminalInfo[]; total: number } {
    let terminals = Array.from(this.terminals.values()).map(session => ({ ...session.info }));

    // フィルタリング
    if (filter) {
      if (filter.sessionNamePattern) {
        const pattern = new RegExp(filter.sessionNamePattern, 'i');
        terminals = terminals.filter(terminal => 
          pattern.test(terminal.session_name || '')
        );
      }

      if (filter.statusFilter && filter.statusFilter !== 'all') {
        terminals = terminals.filter(terminal => terminal.status === filter.statusFilter);
      }
    }

    const total = terminals.length;

    // 制限
    if (filter?.limit) {
      terminals = terminals.slice(0, filter.limit);
    }

    return { terminals, total };
  }

  sendInput(terminalId: string, input: string, execute = false): { success: boolean; timestamp: string } {
    const session = this.terminals.get(terminalId);
    if (!session) {
      throw new ResourceNotFoundError('terminal', terminalId);
    }

    if (session.info.status === 'closed') {
      throw new ExecutionError('Terminal is closed');
    }

    try {
      // 入力を送信
      const inputToSend = execute ? `${input}\r` : input;
      session.ptyProcess.write(inputToSend);

      // 履歴に追加（executeの場合のみ）
      if (execute && input.trim()) {
        session.history.push(input.trim());
        if (session.history.length > this.maxHistoryLines) {
          session.history = session.history.slice(-this.maxHistoryLines);
        }
      }

      // 活動時刻の更新
      session.lastActivity = new Date();
      session.info.last_activity = getCurrentTimestamp();

      return {
        success: true,
        timestamp: getCurrentTimestamp(),
      };

    } catch (error) {
      throw new ExecutionError(`Failed to send input: ${error}`);
    }
  }

  getOutput(
    terminalId: string,
    startLine = 0,
    lineCount = 100,
    includeAnsi = false
  ): {
    output: string;
    line_count: number;
    total_lines: number;
    has_more: boolean;
  } {
    const session = this.terminals.get(terminalId);
    if (!session) {
      throw new ResourceNotFoundError('terminal', terminalId);
    }

    const totalLines = session.outputBuffer.length;
    const endLine = Math.min(startLine + lineCount, totalLines);
    const outputLines = session.outputBuffer.slice(startLine, endLine);

    let output = outputLines.join('\n');

    // ANSI制御コードの除去（オプション）
    if (!includeAnsi) {
      output = this.stripAnsiCodes(output);
    }

    return {
      output,
      line_count: outputLines.length,
      total_lines: totalLines,
      has_more: endLine < totalLines,
    };
  }

  private stripAnsiCodes(text: string): string {
    // ANSI制御コードを除去する正規表現
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  }

  resizeTerminal(terminalId: string, dimensions: Dimensions): { success: boolean; updated_at: string } {
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

  closeTerminal(terminalId: string, saveHistory = true): {
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
}
