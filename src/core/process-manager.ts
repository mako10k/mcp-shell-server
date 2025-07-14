import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  ExecutionInfo,
  ExecutionProcessInfo,
  ExecutionMode,
  ExecutionStatus,
  ProcessSignal,
  EnvironmentVariables,
} from '../types/index.js';
import {
  generateId,
  getCurrentTimestamp,
  getSafeEnvironment,
  sanitizeString,
  ensureDirectory,
} from '../utils/helpers.js';
import {
  ExecutionError,
  TimeoutError,
  ResourceNotFoundError,
  ResourceLimitError,
} from '../utils/errors.js';
import type { TerminalManager } from './terminal-manager.js';

export interface ExecutionOptions {
  command: string;
  executionMode: ExecutionMode;
  workingDirectory?: string;
  environmentVariables?: EnvironmentVariables;
  inputData?: string;
  timeoutSeconds: number;
  maxOutputSize: number;
  captureStderr: boolean;
  sessionId?: string;
  createTerminal?: boolean;
  terminalShell?: string;
  terminalDimensions?: { width: number; height: number };
}

export class ProcessManager {
  private executions = new Map<string, ExecutionInfo>();
  private processes = new Map<number, ChildProcess>();
  private outputFiles = new Map<string, string>();
  private readonly maxConcurrentProcesses: number;
  private readonly outputDir: string;
  private terminalManager?: TerminalManager; // TerminalManager への参照

  constructor(maxConcurrentProcesses = 50, outputDir = '/tmp/mcp-shell-outputs') {
    this.maxConcurrentProcesses = maxConcurrentProcesses;
    this.outputDir = outputDir;
    this.initializeOutputDirectory();
  }

  // TerminalManager への参照を設定
  setTerminalManager(terminalManager: TerminalManager): void {
    this.terminalManager = terminalManager;
  }

  private async initializeOutputDirectory(): Promise<void> {
    await ensureDirectory(this.outputDir);
  }

  async executeCommand(options: ExecutionOptions): Promise<ExecutionInfo> {
    // 同時実行数のチェック
    const runningProcesses = Array.from(this.executions.values()).filter(
      (exec) => exec.status === 'running'
    ).length;

    if (runningProcesses >= this.maxConcurrentProcesses) {
      throw new ResourceLimitError('concurrent processes', this.maxConcurrentProcesses);
    }

    const executionId = generateId();
    const startTime = getCurrentTimestamp();

    // 実行情報の初期化
    const executionInfo: ExecutionInfo = {
      execution_id: executionId,
      command: options.command,
      status: 'running',
      created_at: startTime,
      started_at: startTime,
    };

    if (options.workingDirectory) {
      executionInfo.working_directory = options.workingDirectory;
    }
    if (options.environmentVariables) {
      executionInfo.environment_variables = options.environmentVariables;
    }

    this.executions.set(executionId, executionInfo);

    // 新規ターミナル作成オプションがある場合
    if (options.createTerminal && this.terminalManager) {
      try {
        const terminalOptions: any = {
          sessionName: `exec-${executionId}`,
          workingDirectory: options.workingDirectory,
          environmentVariables: options.environmentVariables,
          // デフォルトの寸法を設定
          dimensions: options.terminalDimensions || { width: 80, height: 24 },
        };

        if (options.terminalShell) {
          terminalOptions.shellType = options.terminalShell;
        }

        const terminalInfo = await this.terminalManager.createTerminal(terminalOptions);
        executionInfo.terminal_id = terminalInfo.terminal_id;

        // ターミナルにコマンドを送信
        this.terminalManager.sendInput(terminalInfo.terminal_id, options.command, true);

        // 実行情報を更新
        executionInfo.status = 'completed';
        executionInfo.completed_at = getCurrentTimestamp();
        this.executions.set(executionId, executionInfo);

        return executionInfo;
      } catch (error) {
        executionInfo.status = 'failed';
        executionInfo.completed_at = getCurrentTimestamp();
        this.executions.set(executionId, executionInfo);
        throw new ExecutionError(`Failed to create terminal: ${error}`, {
          originalError: String(error),
        });
      }
    }

    try {
      switch (options.executionMode) {
        case 'foreground':
          return await this.executeForegroundCommand(executionId, options);
        case 'adaptive':
          return await this.executeAdaptiveCommand(executionId, options);
        case 'background':
          return await this.executeBackgroundCommand(executionId, options);
        case 'detached':
          return await this.executeDetachedCommand(executionId, options);
        default:
          throw new ExecutionError('Unsupported execution mode', { mode: options.executionMode });
      }
    } catch (error) {
      // エラー時の実行情報更新
      const updatedInfo = this.executions.get(executionId);
      if (updatedInfo) {
        updatedInfo.status = 'failed';
        updatedInfo.completed_at = getCurrentTimestamp();
        this.executions.set(executionId, updatedInfo);
      }
      throw error;
    }
  }

  private async executeForegroundCommand(
    executionId: string,
    options: ExecutionOptions
  ): Promise<ExecutionInfo> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let outputTruncated = false;

      // 環境変数の準備
      const env = getSafeEnvironment(
        process.env as Record<string, string>,
        options.environmentVariables
      );

      // プロセスの起動
      const childProcess = spawn('/bin/bash', ['-c', options.command], {
        cwd: options.workingDirectory || process.cwd(),
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.processes.set(childProcess.pid!, childProcess);

      // タイムアウトの設定
      const timeout = setTimeout(() => {
        childProcess.kill('SIGTERM');
        setTimeout(() => {
          if (!childProcess.killed) {
            childProcess.kill('SIGKILL');
          }
        }, 5000);

        const executionInfo = this.executions.get(executionId);
        if (executionInfo) {
          executionInfo.status = 'timeout';
          executionInfo.completed_at = getCurrentTimestamp();
          executionInfo.execution_time_ms = Date.now() - startTime;
          this.executions.set(executionId, executionInfo);
        }

        reject(new TimeoutError(options.timeoutSeconds));
      }, options.timeoutSeconds * 1000);

      // 標準入力の送信
      if (options.inputData) {
        childProcess.stdin?.write(options.inputData);
        childProcess.stdin?.end();
      } else {
        childProcess.stdin?.end();
      }

      // 標準出力の処理
      childProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        if (stdout.length + output.length <= options.maxOutputSize) {
          stdout += output;
        } else {
          stdout += output.substring(0, options.maxOutputSize - stdout.length);
          outputTruncated = true;
        }
      });

      // 標準エラー出力の処理
      if (options.captureStderr) {
        childProcess.stderr?.on('data', (data: Buffer) => {
          const output = data.toString();
          if (stderr.length + output.length <= options.maxOutputSize) {
            stderr += output;
          } else {
            stderr += output.substring(0, options.maxOutputSize - stderr.length);
            outputTruncated = true;
          }
        });
      }

      // プロセス終了時の処理
      childProcess.on('close', async (code) => {
        clearTimeout(timeout);
        this.processes.delete(childProcess.pid!);

        const executionTime = Date.now() - startTime;
        const executionInfo = this.executions.get(executionId);

        if (executionInfo) {
          executionInfo.status = 'completed';
          executionInfo.exit_code = code || 0;
          executionInfo.stdout = sanitizeString(stdout);
          executionInfo.stderr = sanitizeString(stderr);
          executionInfo.output_truncated = outputTruncated;
          executionInfo.execution_time_ms = executionTime;
          if (childProcess.pid !== undefined) {
            executionInfo.process_id = childProcess.pid;
          }
          executionInfo.completed_at = getCurrentTimestamp();

          // 大きな出力の場合はファイルに保存
          if (
            outputTruncated ||
            stdout.length > options.maxOutputSize ||
            stderr.length > options.maxOutputSize
          ) {
            try {
              const outputFileId = await this.saveOutputToFile(executionId, stdout, stderr);
              executionInfo.output_id = outputFileId;
            } catch (error) {
              // エラーログを内部ログに記録（標準出力を避ける）
              // console.error('Failed to save output to file:', error);
            }
          }

          this.executions.set(executionId, executionInfo);
          resolve(executionInfo);
        }
      });

      // エラー処理
      childProcess.on('error', (error) => {
        clearTimeout(timeout);
        this.processes.delete(childProcess.pid!);

        const executionInfo = this.executions.get(executionId);
        if (executionInfo) {
          executionInfo.status = 'failed';
          executionInfo.completed_at = getCurrentTimestamp();
          executionInfo.execution_time_ms = Date.now() - startTime;
          this.executions.set(executionId, executionInfo);
        }

        reject(
          new ExecutionError(`Process execution failed: ${error.message}`, {
            originalError: error.message,
          })
        );
      });
    });
  }

  private async executeAdaptiveCommand(
    executionId: string,
    options: ExecutionOptions
  ): Promise<ExecutionInfo> {
    // adaptiveモード: 最初に短時間フォアグラウンドで実行し、
    // タイムアウトした場合はバックグラウンドに移行
    const returnPartialOnTimeout = (options as any).return_partial_on_timeout ?? true;

    try {
      // フォアグラウンドで実行開始  
      return await this.executeForegroundCommand(executionId, options);
    } catch (error) {
      if (error instanceof TimeoutError && returnPartialOnTimeout) {
        // タイムアウトした場合、バックグラウンドに移行
        const executionInfo = this.executions.get(executionId);
        if (executionInfo) {
          // 部分出力フラグを設定
          executionInfo.output_truncated = true;
          executionInfo.status = 'running'; // バックグラウンドで継続実行中
          this.executions.set(executionId, executionInfo);
          
          // バックグラウンドで継続実行
          this.executeBackgroundCommand(executionId, { ...options, executionMode: 'background' as ExecutionMode }).catch(() => {
            // バックグラウンド実行でエラーが発生した場合の処理
          });
          
          return executionInfo;
        }
      }
      throw error;
    }
  }

  private async executeBackgroundCommand(
    executionId: string,
    options: ExecutionOptions
  ): Promise<ExecutionInfo> {
    const env = getSafeEnvironment(
      process.env as Record<string, string>,
      options.environmentVariables
    );

    const childProcess = spawn('/bin/bash', ['-c', options.command], {
      cwd: options.workingDirectory || process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: options.executionMode === 'background',
    });

    this.processes.set(childProcess.pid!, childProcess);

    const executionInfo = this.executions.get(executionId);
    if (executionInfo && childProcess.pid !== undefined) {
      executionInfo.process_id = childProcess.pid;
      this.executions.set(executionId, executionInfo);
    }

    // バックグラウンドプロセスの場合、出力を非同期で処理
    if (options.executionMode === 'background') {
      this.handleBackgroundProcess(executionId, childProcess, options);
    }

    return executionInfo!;
  }

  private handleBackgroundProcess(
    executionId: string,
    childProcess: ChildProcess,
    options: ExecutionOptions
  ): void {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';

    // 出力の収集
    childProcess.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    if (options.captureStderr) {
      childProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
    }

    // プロセス終了時の処理
    childProcess.on('close', async (code) => {
      this.processes.delete(childProcess.pid!);

      const executionInfo = this.executions.get(executionId);
      if (executionInfo) {
        executionInfo.status = 'completed';
        executionInfo.exit_code = code || 0;
        executionInfo.execution_time_ms = Date.now() - startTime;
        executionInfo.completed_at = getCurrentTimestamp();

        // 出力をファイルに保存
        try {
          const outputFileId = await this.saveOutputToFile(executionId, stdout, stderr);
          executionInfo.output_id = outputFileId;
        } catch (error) {
          // エラーログを内部ログに記録（標準出力を避ける）
          // console.error('Failed to save background process output:', error);
        }

        this.executions.set(executionId, executionInfo);
      }
    });

    childProcess.on('error', () => {
      this.processes.delete(childProcess.pid!);
      const executionInfo = this.executions.get(executionId);
      if (executionInfo) {
        executionInfo.status = 'failed';
        executionInfo.execution_time_ms = Date.now() - startTime;
        executionInfo.completed_at = getCurrentTimestamp();
        this.executions.set(executionId, executionInfo);
      }
    });
  }

  private async executeDetachedCommand(
    executionId: string,
    options: ExecutionOptions
  ): Promise<ExecutionInfo> {
    // detachedモード: 完全にバックグラウンドで実行し、親プロセスとの接続を切断
    const env = getSafeEnvironment(
      process.env as Record<string, string>,
      options.environmentVariables
    );

    const childProcess = spawn('/bin/bash', ['-c', options.command], {
      cwd: options.workingDirectory || process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'], // stdin は無視
      detached: true, // 完全にデタッチ
    });

    // デタッチされたプロセスのPIDは記録するが、プロセス管理からは除外
    const executionInfo = this.executions.get(executionId);
    if (executionInfo && childProcess.pid !== undefined) {
      executionInfo.process_id = childProcess.pid;
      executionInfo.status = 'running';
      this.executions.set(executionId, executionInfo);
    }

    // デタッチされたプロセスは親プロセスの終了後も継続実行されるため、
    // 出力の収集は限定的
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';

    if (childProcess.stdout) {
      childProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
    }

    if (childProcess.stderr) {
      childProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
    }

    // プロセスの終了を監視（デタッチされているため必ずしも捕捉されない）
    childProcess.on('close', async (code) => {
      const executionInfo = this.executions.get(executionId);
      if (executionInfo) {
        executionInfo.status = 'completed';
        executionInfo.exit_code = code || 0;
        executionInfo.execution_time_ms = Date.now() - startTime;
        executionInfo.completed_at = getCurrentTimestamp();

        try {
          const outputFileId = await this.saveOutputToFile(executionId, stdout, stderr);
          executionInfo.output_id = outputFileId;
        } catch (error) {
          // エラーログを内部ログに記録
        }

        this.executions.set(executionId, executionInfo);
      }
    });

    // プロセスをデタッチ
    childProcess.unref();

    return this.executions.get(executionId)!;
  }

  private async saveOutputToFile(
    executionId: string,
    stdout: string,
    stderr: string
  ): Promise<string> {
    const outputFileId = generateId();
    const filePath = path.join(this.outputDir, `${outputFileId}.json`);

    const outputData = {
      execution_id: executionId,
      stdout,
      stderr,
      created_at: getCurrentTimestamp(),
    };

    await fs.writeFile(filePath, JSON.stringify(outputData, null, 2), 'utf-8');
    this.outputFiles.set(outputFileId, filePath);

    return outputFileId;
  }

  getExecution(executionId: string): ExecutionInfo | undefined {
    return this.executions.get(executionId);
  }

  listExecutions(filter?: {
    status?: ExecutionStatus;
    commandPattern?: string;
    sessionId?: string;
    limit?: number;
    offset?: number;
  }): { executions: ExecutionInfo[]; total: number } {
    let executions = Array.from(this.executions.values());

    // フィルタリング
    if (filter) {
      if (filter.status) {
        executions = executions.filter((exec) => exec.status === filter.status);
      }
      if (filter.commandPattern) {
        const pattern = new RegExp(filter.commandPattern, 'i');
        executions = executions.filter((exec) => pattern.test(exec.command));
      }
      if (filter.sessionId) {
        // セッション管理は今後実装
      }
    }

    const total = executions.length;

    // ページネーション
    if (filter?.offset || filter?.limit) {
      const offset = filter.offset || 0;
      const limit = filter.limit || 50;
      executions = executions.slice(offset, offset + limit);
    }

    return { executions, total };
  }

  async killProcess(
    processId: number,
    signal: ProcessSignal = 'TERM',
    force = false
  ): Promise<{
    success: boolean;
    signal_sent: ProcessSignal;
    exit_code?: number;
    message: string;
  }> {
    const childProcess = this.processes.get(processId);

    if (!childProcess) {
      throw new ResourceNotFoundError('process', processId.toString());
    }

    try {
      // プロセスを終了
      const signalName = signal === 'KILL' ? 'SIGKILL' : `SIG${signal}`;
      const killed = childProcess.kill(signalName as any);

      if (!killed && force && signal !== 'KILL') {
        // 強制終了
        childProcess.kill('SIGKILL');
      }

      // プロセスが終了するまで待機
      await new Promise<void>((resolve) => {
        childProcess.on('close', () => resolve());
        setTimeout(() => resolve(), 5000); // 5秒でタイムアウト
      });

      this.processes.delete(processId);

      return {
        success: true,
        signal_sent: signal,
        exit_code: childProcess.exitCode || undefined,
        message: 'Process terminated successfully',
      } as {
        success: boolean;
        signal_sent: ProcessSignal;
        exit_code?: number;
        message: string;
      };
    } catch (error) {
      return {
        success: false,
        signal_sent: signal,
        message: `Failed to kill process: ${error}`,
      };
    }
  }

  listProcesses(): ExecutionProcessInfo[] {
    const processes: ExecutionProcessInfo[] = [];

    for (const [pid] of this.processes) {
      // 対応する実行情報を検索
      const execution = Array.from(this.executions.values()).find(
        (exec) => exec.process_id === pid
      );

      if (execution) {
        const processInfo: ExecutionProcessInfo = {
          process_id: pid,
          execution_id: execution.execution_id,
          command: execution.command,
          status: execution.status,
          created_at: execution.created_at,
        };

        if (execution.working_directory) {
          processInfo.working_directory = execution.working_directory;
        }
        if (execution.environment_variables) {
          processInfo.environment_variables = execution.environment_variables;
        }
        if (execution.started_at) {
          processInfo.started_at = execution.started_at;
        }
        if (execution.completed_at) {
          processInfo.completed_at = execution.completed_at;
        }

        processes.push(processInfo);
      }
    }

    return processes;
  }

  cleanup(): void {
    // 実行中のプロセスを全て終了
    for (const [_pid, childProcess] of this.processes) {
      try {
        childProcess.kill('SIGTERM');
        setTimeout(() => {
          if (!childProcess.killed) {
            childProcess.kill('SIGKILL');
          }
        }, 5000);
      } catch (error) {
        // エラーログを内部ログに記録（標準出力を避ける）
        // console.error(`Failed to cleanup process ${pid}:`, error);
      }
    }

    this.processes.clear();
    this.executions.clear();
  }
}
