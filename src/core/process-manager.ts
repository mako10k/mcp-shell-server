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
  OutputTruncationReason,
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
import type { FileManager } from './file-manager.js';
import { StreamPublisher } from './stream-publisher.js';
import { FileStorageSubscriber } from './file-storage-subscriber.js';
import { StreamingPipelineReader } from './streaming-pipeline-reader.js';
import { RealtimeStreamSubscriber } from './realtime-stream-subscriber.js';

export interface ExecutionOptions {
  command: string;
  executionMode: ExecutionMode;
  workingDirectory?: string;
  environmentVariables?: EnvironmentVariables;
  inputData?: string;
  inputOutputId?: string;
  timeoutSeconds: number;
  foregroundTimeoutSeconds?: number;
  maxOutputSize: number;
  captureStderr: boolean;
  sessionId?: string;
  createTerminal?: boolean;
  terminalShell?: string;
  terminalDimensions?: { width: number; height: number };
  returnPartialOnTimeout?: boolean;
}

// バックグラウンドプロセス終了時のコールバック型
interface BackgroundProcessCallback {
  onComplete?: (executionId: string, executionInfo: ExecutionInfo) => void | Promise<void>;
  onError?: (executionId: string, executionInfo: ExecutionInfo, error: any) => void | Promise<void>;
  onTimeout?: (executionId: string, executionInfo: ExecutionInfo) => void | Promise<void>;
}

export class ProcessManager {
  private executions = new Map<string, ExecutionInfo>();
  private processes = new Map<number, ChildProcess>();
  private readonly maxConcurrentProcesses: number;
  private readonly outputDir: string;
  private terminalManager?: TerminalManager; // TerminalManager への参照
  private fileManager: FileManager | undefined; // FileManager への参照
  private defaultWorkingDirectory: string;
  private allowedWorkingDirectories: string[];
  private backgroundProcessCallbacks: BackgroundProcessCallback = {}; // バックグラウンドプロセス終了コールバック
  
  // Issue #13: PUB/SUB統合 - Feature Flag付きで段階的統合
  private streamPublisher: StreamPublisher;
  private fileStorageSubscriber: FileStorageSubscriber | undefined;
  private realtimeStreamSubscriber: RealtimeStreamSubscriber | undefined;
  private enableStreaming: boolean = false; // Feature Flag

  constructor(maxConcurrentProcesses = 50, outputDir = '/tmp/mcp-shell-outputs', fileManager?: FileManager) {
    this.maxConcurrentProcesses = maxConcurrentProcesses;
    this.outputDir = outputDir;
    this.fileManager = fileManager;
    this.defaultWorkingDirectory = process.env['MCP_SHELL_DEFAULT_WORKDIR'] || process.cwd();
    this.allowedWorkingDirectories = process.env['MCP_SHELL_ALLOWED_WORKDIRS'] 
      ? process.env['MCP_SHELL_ALLOWED_WORKDIRS'].split(',').map(dir => dir.trim())
      : [process.cwd()];
    
    // StreamPublisher初期化
    this.streamPublisher = new StreamPublisher({
      enableRealtimeStreaming: false, // 初期状態は無効
      bufferSize: 8192,
      notificationInterval: 100
    });
    
    // 環境変数でStreaming機能を制御（段階的展開、デフォルト有効）
    this.enableStreaming = process.env['MCP_SHELL_ENABLE_STREAMING'] !== 'false';
    
    if (this.enableStreaming) {
      this.initializeStreamingComponents();
    }
    this.initializeOutputDirectory();
  }

  // TerminalManager への参照を設定
  setTerminalManager(terminalManager: TerminalManager): void {
    this.terminalManager = terminalManager;
  }

  // FileManager への参照を設定
  setFileManager(fileManager: FileManager): void {
    this.fileManager = fileManager;
    
    // FileManagerが設定された時にStreaming機能を再初期化
    if (this.enableStreaming) {
      this.initializeStreamingComponents();
    }
  }

  // バックグラウンドプロセス終了時のコールバックを設定
  setBackgroundProcessCallbacks(callbacks: BackgroundProcessCallback): void {
    this.backgroundProcessCallbacks = callbacks;
  }
  
  // Issue #13: Streaming コンポーネントの初期化
  private initializeStreamingComponents(): void {
    if (!this.fileManager) {
      console.error('ProcessManager: FileManager is required for streaming components');
      return;
    }
    
    // FileStorageSubscriber初期化（既存FileManager機能を代替）
    this.fileStorageSubscriber = new FileStorageSubscriber(this.fileManager, this.outputDir);
    this.streamPublisher.subscribe(this.fileStorageSubscriber);
    
    // RealtimeStreamSubscriber初期化
    this.realtimeStreamSubscriber = new RealtimeStreamSubscriber({
      bufferSize: 8192,
      notificationInterval: 100,
      maxRetentionSeconds: 3600,
      maxBuffers: 1000
    });
    this.streamPublisher.subscribe(this.realtimeStreamSubscriber);
    
    console.error('ProcessManager: Streaming components initialized');
  }
  
  // Issue #13: Streaming機能の有効/無効切り替え
  enableStreamingFeature(enable: boolean = true): void {
    this.enableStreaming = enable;
    
    if (enable && this.fileManager) {
      this.initializeStreamingComponents();
    } else if (!enable) {
      // Streaming無効化時のクリーンアップ
      if (this.realtimeStreamSubscriber) {
        this.streamPublisher.unsubscribe(this.realtimeStreamSubscriber.id);
        this.realtimeStreamSubscriber.destroy();
        this.realtimeStreamSubscriber = undefined;
      }
      
      if (this.fileStorageSubscriber) {
        this.streamPublisher.unsubscribe(this.fileStorageSubscriber.id);
        this.fileStorageSubscriber = undefined;
      }
    }
  }
  
  // Issue #13: RealtimeStreamSubscriber への参照を取得（新しいMCPツール用）
  getRealtimeStreamSubscriber(): RealtimeStreamSubscriber | undefined {
    return this.realtimeStreamSubscriber;
  }

  /**
   * Issue #13: output_idから実行IDを取得
   */
  private findExecutionIdByOutputId(outputId: string): string | undefined {
    return this.fileManager?.getExecutionIdByOutputId(outputId);
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

    // 入力データの準備 - input_output_idが指定された場合の処理
    let resolvedInputData: string | undefined = options.inputData;
    let inputStream: StreamingPipelineReader | undefined = undefined;
    
    if (options.inputOutputId) {
      if (!this.fileManager) {
        throw new ExecutionError('FileManager is not available for input_output_id processing', {
          inputOutputId: options.inputOutputId,
        });
      }
      
      // output_idから実行IDを特定
      const sourceExecutionId = this.findExecutionIdByOutputId(options.inputOutputId);
      
      if (sourceExecutionId && this.realtimeStreamSubscriber) {
        // 実行中プロセスの場合: StreamingPipelineReaderを使用
        const streamState = this.realtimeStreamSubscriber.getStreamState(sourceExecutionId);
        if (streamState && streamState.isActive) {
          console.error(`ProcessManager: Using streaming pipeline for active process ${sourceExecutionId}`);
          inputStream = new StreamingPipelineReader(
            this.fileManager,
            this.realtimeStreamSubscriber,
            options.inputOutputId,
            sourceExecutionId
          );
        }
      }
      
      // 実行中プロセスでない場合、または失敗した場合: 従来のファイル読み取り
      if (!inputStream) {
        try {
          console.error(`ProcessManager: Using traditional file read for ${options.inputOutputId}`);
          const result = await this.fileManager.readFile(
            options.inputOutputId,
            0,
            100 * 1024 * 1024, // 100MB まで読み取り
            'utf-8'
          );
          resolvedInputData = result.content;
        } catch (error) {
          throw new ExecutionError(`Failed to read input from output_id: ${options.inputOutputId}`, {
            inputOutputId: options.inputOutputId,
            originalError: String(error),
          });
        }
      }
    }

    const executionId = generateId();
    const startTime = getCurrentTimestamp();

    // 実行情報の初期化
    const resolvedWorkingDirectory = this.resolveWorkingDirectory(options.workingDirectory);
    const executionInfo: ExecutionInfo = {
      execution_id: executionId,
      command: options.command,
      status: 'running',
      working_directory: resolvedWorkingDirectory,
      default_working_directory: this.defaultWorkingDirectory,
      working_directory_changed: resolvedWorkingDirectory !== this.defaultWorkingDirectory,
      created_at: startTime,
      started_at: startTime,
    };

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
      // 実行オプションを準備
      const { inputOutputId, ...baseOptions } = options;
      const updatedOptions: ExecutionOptions = { 
        ...baseOptions,
        ...(resolvedInputData !== undefined && { inputData: resolvedInputData })
      };
      
      // StreamingPipelineReaderがある場合は特別処理
      if (inputStream) {
        return await this.executeCommandWithInputStream(executionId, updatedOptions, inputStream);
      }
      
      switch (options.executionMode) {
        case 'foreground':
          return await this.executeForegroundCommand(executionId, updatedOptions);
        case 'adaptive':
          return await this.executeAdaptiveCommand(executionId, updatedOptions);
        case 'background':
          return await this.executeBackgroundCommand(executionId, updatedOptions);
        case 'detached':
          return await this.executeDetachedCommand(executionId, updatedOptions);
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

  /**
   * Issue #13: StreamingPipelineReaderを使用したコマンド実行
   */
  private async executeCommandWithInputStream(
    executionId: string,
    options: ExecutionOptions,
    inputStream: StreamingPipelineReader
  ): Promise<ExecutionInfo> {
    console.error(`ProcessManager: Executing command with input stream for ${executionId}`);
    
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
      const child = spawn('sh', ['-c', options.command], {
        cwd: this.resolveWorkingDirectory(options.workingDirectory),
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // StreamingPipelineReaderをSTDINに接続
      inputStream.pipe(child.stdin!);
      
      inputStream.on('error', (error) => {
        console.error(`StreamingPipelineReader error for ${executionId}: ${error.message}`);
        child.kill('SIGTERM');
      });

      // StreamPublisher通知
      if (this.streamPublisher) {
        this.streamPublisher.notifyProcessStart(executionId, options.command);
      }

      // STDOUT処理
      child.stdout!.on('data', (data) => {
        const chunk = data.toString();
        if (stdout.length + chunk.length <= options.maxOutputSize) {
          stdout += chunk;
        } else {
          outputTruncated = true;
        }

        // StreamPublisher通知
        if (this.streamPublisher) {
          this.streamPublisher.notifyOutputData(executionId, chunk, false);
        }
      });

      // STDERR処理
      if (options.captureStderr) {
        child.stderr!.on('data', (data) => {
          const chunk = data.toString();
          if (stderr.length + chunk.length <= options.maxOutputSize) {
            stderr += chunk;
          } else {
            outputTruncated = true;
          }

          // StreamPublisher通知
          if (this.streamPublisher) {
            this.streamPublisher.notifyOutputData(executionId, chunk, true);
          }
        });
      }

      // プロセス終了処理
      child.on('close', async (code) => {
        const executionInfo = this.executions.get(executionId);
        if (!executionInfo) {
          reject(new ExecutionError('Execution info not found', { executionId }));
          return;
        }

        // 実行時間の計算
        const executionTime = Date.now() - startTime;

        // 実行情報の更新
        executionInfo.status = code === 0 ? 'completed' : 'failed';
        executionInfo.completed_at = getCurrentTimestamp();
        if (code !== null) {
          executionInfo.exit_code = code;
        }
        executionInfo.execution_time_ms = executionTime;

        // 出力の保存
        if (this.fileManager) {
          try {
            const combinedOutput = stdout + (options.captureStderr ? stderr : '');
            if (combinedOutput) {
              const outputId = await this.fileManager.createOutputFile(combinedOutput, executionId);
              executionInfo.output_id = outputId;
              executionInfo.output_truncated = outputTruncated;
            }
          } catch (error) {
            console.error(`Failed to save output for ${executionId}: ${error}`);
          }
        }

        this.executions.set(executionId, executionInfo);

        // StreamPublisher通知
        if (this.streamPublisher) {
          this.streamPublisher.notifyProcessEnd(executionId, code);
        }

        console.error(`Command completed: ${options.command} (exit code: ${code})`);
        resolve(executionInfo);
      });

      child.on('error', (error) => {
        console.error(`Process error for ${executionId}: ${error.message}`);
        
        // StreamPublisher通知
        if (this.streamPublisher) {
          this.streamPublisher.notifyError(executionId, error);
        }

        reject(new ExecutionError(`Process error: ${error.message}`, { originalError: String(error) }));
      });

      // タイムアウト処理
      const timeout = setTimeout(() => {
        console.error(`Process timeout for ${executionId}`);
        child.kill('SIGTERM');
        
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000);
      }, options.timeoutSeconds * 1000);

      child.on('close', () => {
        clearTimeout(timeout);
      });
    });
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
        cwd: this.resolveWorkingDirectory(options.workingDirectory),
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.processes.set(childProcess.pid!, childProcess);

      // タイムアウトの設定
      const timeout = setTimeout(async () => {
        childProcess.kill('SIGTERM');
        setTimeout(() => {
          if (!childProcess.killed) {
            childProcess.kill('SIGKILL');
          }
        }, 5000);

        const executionTime = Date.now() - startTime;
        const executionInfo = this.executions.get(executionId);
        if (executionInfo) {
          executionInfo.status = 'timeout';
          executionInfo.stdout = sanitizeString(stdout);
          executionInfo.stderr = sanitizeString(stderr);
          executionInfo.completed_at = getCurrentTimestamp();
          executionInfo.execution_time_ms = executionTime;
          if (childProcess.pid !== undefined) {
            executionInfo.process_id = childProcess.pid;
          }

          // 出力をFileManagerに保存（サイズに関係なく）
          let outputFileId: string | undefined;
          try {
            outputFileId = await this.saveOutputToFile(executionId, stdout, stderr);
            executionInfo.output_id = outputFileId;
          } catch (error) {
            // ファイル保存失敗は重要なエラーとしてログに記録し、実行情報に含める
            console.error(`[CRITICAL] Failed to save output file for execution ${executionId}:`, error);
            executionInfo.message = `Output file save failed: ${error instanceof Error ? error.message : String(error)}`;
          }

          // 出力状態の詳細情報を設定
          this.setOutputStatus(executionInfo, outputTruncated, 'timeout', outputFileId);

          this.executions.set(executionId, executionInfo);

          // return_partial_on_timeout が true の場合は部分結果を返す
          if (options.returnPartialOnTimeout) {
            resolve(executionInfo);
            return;
          }
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
          executionInfo.execution_time_ms = executionTime;
          if (childProcess.pid !== undefined) {
            executionInfo.process_id = childProcess.pid;
          }
          executionInfo.completed_at = getCurrentTimestamp();

          // 出力をFileManagerに保存（サイズに関係なく）
          let outputFileId: string | undefined;
          try {
            outputFileId = await this.saveOutputToFile(executionId, stdout, stderr);
            executionInfo.output_id = outputFileId;
          } catch (error) {
            // ファイル保存失敗は重要なエラーとしてログに記録し、実行情報に含める
            console.error(`[CRITICAL] Failed to save output file for execution ${executionId}:`, error);
            executionInfo.message = `Output file save failed: ${error instanceof Error ? error.message : String(error)}`;
          }

          // 出力状態の詳細情報を設定
          if (outputTruncated) {
            this.setOutputStatus(executionInfo, true, 'size_limit', outputFileId);
          } else {
            // 通常完了時 - actuallyTruncated=false, 適当なreasonで完了時ガイダンスを表示
            this.setOutputStatus(executionInfo, false, 'size_limit', outputFileId);
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
    // adaptiveモード: 1つのプロセスを起動し、以下の条件でバックグラウンドに移行
    // 1. フォアグラウンドタイムアウトに達した場合
    // 2. 出力サイズ制限に達した場合
    const returnPartialOnTimeout = options.returnPartialOnTimeout ?? true;
    const foregroundTimeout = options.foregroundTimeoutSeconds ?? 10;

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let outputTruncated = false;
      let backgroundTransitionReason: 'timeout' | 'output_size_limit' | null = null;

      // 環境変数の準備
      const env = getSafeEnvironment(
        process.env as Record<string, string>,
        options.environmentVariables
      );

      // プロセスの起動（バックグラウンド対応）
      const childProcess = spawn('/bin/bash', ['-c', options.command], {
        cwd: this.resolveWorkingDirectory(options.workingDirectory),
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.processes.set(childProcess.pid!, childProcess);

      // フォアグラウンドタイムアウトの設定
      const foregroundTimeoutHandle = setTimeout(() => {
        if (!backgroundTransitionReason) {
          backgroundTransitionReason = 'timeout';
          transitionToBackground();
        }
      }, foregroundTimeout * 1000);

      // 最終タイムアウトの設定
      const finalTimeoutHandle = setTimeout(async () => {
        childProcess.kill('SIGTERM');
        setTimeout(() => {
          if (!childProcess.killed) {
            childProcess.kill('SIGKILL');
          }
        }, 5000);

        const executionInfo = this.executions.get(executionId);
        if (executionInfo) {
          executionInfo.status = 'timeout';
          executionInfo.stdout = sanitizeString(stdout);
          executionInfo.stderr = sanitizeString(stderr);
          executionInfo.output_truncated = outputTruncated;
          executionInfo.completed_at = getCurrentTimestamp();
          executionInfo.execution_time_ms = Date.now() - startTime;

          // 出力をFileManagerに保存
          try {
            const outputFileId = await this.saveOutputToFile(executionId, stdout, stderr);
            executionInfo.output_id = outputFileId;
          } catch (error) {
            // ファイル保存失敗は重要なエラーとしてログに記録し、実行情報に含める
            console.error(`[CRITICAL] Failed to save output file for execution ${executionId}:`, error);
            executionInfo.message = `Output file save failed: ${error instanceof Error ? error.message : String(error)}`;
          }

          this.executions.set(executionId, executionInfo);

          if (returnPartialOnTimeout) {
            resolve(executionInfo);
            return;
          }
        }

        reject(new TimeoutError(options.timeoutSeconds));
      }, options.timeoutSeconds * 1000);

      // バックグラウンドに移行する関数
      const transitionToBackground = async () => {
        clearTimeout(foregroundTimeoutHandle);

        const executionInfo = this.executions.get(executionId);
        if (executionInfo) {
          executionInfo.status = 'running';
          executionInfo.stdout = sanitizeString(stdout);
          executionInfo.stderr = sanitizeString(stderr);
          
          // 移行理由を記録
          if (backgroundTransitionReason === 'timeout') {
            executionInfo.transition_reason = 'foreground_timeout';
          } else if (backgroundTransitionReason === 'output_size_limit') {
            executionInfo.transition_reason = 'output_size_limit';
          }

          if (childProcess.pid !== undefined) {
            executionInfo.process_id = childProcess.pid;
          }

          // 出力をFileManagerに保存
          let outputFileId: string | undefined;
          try {
            outputFileId = await this.saveOutputToFile(executionId, stdout, stderr);
            executionInfo.output_id = outputFileId;
          } catch (error) {
            // ファイル保存失敗は重要なエラーとしてログに記録し、実行情報に含める
            console.error(`[CRITICAL] Failed to save output file for execution ${executionId}:`, error);
            executionInfo.message = `Output file save failed: ${error instanceof Error ? error.message : String(error)}`;
          }

          // 出力状態の詳細情報を設定（バックグラウンド移行）
          this.setOutputStatus(executionInfo, outputTruncated, 'background_transition', outputFileId);

          this.executions.set(executionId, executionInfo);

          // バックグラウンド処理の継続設定（adaptive mode専用）
          this.handleAdaptiveBackgroundTransition(executionId, childProcess, {
            ...options,
            timeoutSeconds: Math.max(1, options.timeoutSeconds - Math.floor((Date.now() - startTime) / 1000))
          });

          resolve(executionInfo);
        }
      };

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
          
          // 出力サイズ制限に達した場合、バックグラウンドに移行
          if (!backgroundTransitionReason) {
            backgroundTransitionReason = 'output_size_limit';
            transitionToBackground();
          }
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
            
            // 出力サイズ制限に達した場合、バックグラウンドに移行
            if (!backgroundTransitionReason) {
              backgroundTransitionReason = 'output_size_limit';
              transitionToBackground();
            }
          }
        });
      }

      // プロセス終了時の処理
      childProcess.on('close', async (code) => {
        clearTimeout(foregroundTimeoutHandle);
        clearTimeout(finalTimeoutHandle);
        this.processes.delete(childProcess.pid!);

        // バックグラウンドに移行していない場合のみ処理
        if (!backgroundTransitionReason) {
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

            // 出力をFileManagerに保存
            try {
              const outputFileId = await this.saveOutputToFile(executionId, stdout, stderr);
              executionInfo.output_id = outputFileId;
            } catch (error) {
              // ファイル保存失敗は重要なエラーとしてログに記録し、実行情報に含める
              console.error(`[CRITICAL] Failed to save output file for execution ${executionId}:`, error);
              executionInfo.message = `Output file save failed: ${error instanceof Error ? error.message : String(error)}`;
            }

            this.executions.set(executionId, executionInfo);
            resolve(executionInfo);
          }
        }
      });

      // エラー処理
      childProcess.on('error', (error) => {
        clearTimeout(foregroundTimeoutHandle);
        clearTimeout(finalTimeoutHandle);
        this.processes.delete(childProcess.pid!);

        if (!backgroundTransitionReason) {
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
        }
      });
    });
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
      cwd: this.resolveWorkingDirectory(options.workingDirectory),
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

    // タイムアウトの設定（backgroundプロセス用）
    const timeout = setTimeout(async () => {
      childProcess.kill('SIGTERM');
      setTimeout(() => {
        if (!childProcess.killed) {
          childProcess.kill('SIGKILL');
        }
      }, 5000);

      const executionInfo = this.executions.get(executionId);
      if (executionInfo) {
        executionInfo.status = 'timeout';
        executionInfo.stdout = stdout;
        executionInfo.stderr = stderr;
        executionInfo.output_truncated = true;
        executionInfo.completed_at = getCurrentTimestamp();
        executionInfo.execution_time_ms = Date.now() - startTime;

        // 出力をFileManagerに保存
        try {
          const outputFileId = await this.saveOutputToFile(executionId, stdout, stderr);
          executionInfo.output_id = outputFileId;
        } catch (error) {
          // ファイル保存失敗は重要なエラーとしてログに記録し、実行情報に含める
          console.error(`[CRITICAL] Failed to save output file for execution ${executionId}:`, error);
          executionInfo.message = `Output file save failed: ${error instanceof Error ? error.message : String(error)}`;
        }

        this.executions.set(executionId, executionInfo);
        
        // バックグラウンドプロセスタイムアウトのコールバック呼び出し
        if (this.backgroundProcessCallbacks.onTimeout) {
          setImmediate(async () => {
            try {
              const result = this.backgroundProcessCallbacks.onTimeout!(executionId, executionInfo);
              if (result instanceof Promise) {
                await result;
              }
            } catch (callbackError) {
              // コールバックエラーは内部ログに記録のみ
              // console.error('Background process timeout callback error:', callbackError);
            }
          });
        }
      }
    }, options.timeoutSeconds * 1000);

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
      clearTimeout(timeout);
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
          // ファイル保存失敗は重要なエラーとしてログに記録し、実行情報に含める
          console.error(`[CRITICAL] Failed to save output file for execution ${executionId}:`, error);
          executionInfo.message = `Output file save failed: ${error instanceof Error ? error.message : String(error)}`;
        }

        this.executions.set(executionId, executionInfo);
        
        // バックグラウンドプロセス正常終了のコールバック呼び出し
        if (this.backgroundProcessCallbacks.onComplete) {
          setImmediate(async () => {
            try {
              const result = this.backgroundProcessCallbacks.onComplete!(executionId, executionInfo);
              if (result instanceof Promise) {
                await result;
              }
            } catch (callbackError) {
              // コールバックエラーは内部ログに記録のみ
              // console.error('Background process completion callback error:', callbackError);
            }
          });
        }
      }
    });

    childProcess.on('error', (error) => {
      clearTimeout(timeout);
      this.processes.delete(childProcess.pid!);
      const executionInfo = this.executions.get(executionId);
      if (executionInfo) {
        executionInfo.status = 'failed';
        executionInfo.execution_time_ms = Date.now() - startTime;
        executionInfo.completed_at = getCurrentTimestamp();
        this.executions.set(executionId, executionInfo);
        
        // バックグラウンドプロセスエラーのコールバック呼び出し
        if (this.backgroundProcessCallbacks.onError) {
          setImmediate(async () => {
            try {
              const result = this.backgroundProcessCallbacks.onError!(executionId, executionInfo, error);
              if (result instanceof Promise) {
                await result;
              }
            } catch (callbackError) {
              // コールバックエラーは内部ログに記録のみ
              // console.error('Background process error callback error:', callbackError);
            }
          });
        }
      }
    });
  }

  // adaptive modeでバックグラウンドに移行したプロセスの処理
  private handleAdaptiveBackgroundTransition(
    executionId: string,
    childProcess: ChildProcess,
    options: ExecutionOptions
  ): void {
    // タイムアウトの設定（最終タイムアウト）
    const timeout = setTimeout(async () => {
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
        
        // 既存の出力は保持（adaptive modeで既にキャプチャ済み）
        this.executions.set(executionId, executionInfo);
      }
    }, options.timeoutSeconds * 1000);

    // プロセス終了時の処理
    childProcess.on('close', async (code) => {
      clearTimeout(timeout);
      this.processes.delete(childProcess.pid!);

      const executionInfo = this.executions.get(executionId);
      if (executionInfo) {
        executionInfo.status = 'completed';
        executionInfo.exit_code = code || 0;
        executionInfo.completed_at = getCurrentTimestamp();
        
        // 実行時間は全体（フォアグラウンド + バックグラウンド）で計算
        if (executionInfo.started_at) {
          const startTime = new Date(executionInfo.started_at).getTime();
          executionInfo.execution_time_ms = Date.now() - startTime;
        }

        this.executions.set(executionId, executionInfo);
        
        // adaptive modeバックグラウンドプロセス正常終了のコールバック呼び出し
        if (this.backgroundProcessCallbacks.onComplete) {
          setImmediate(async () => {
            try {
              const result = this.backgroundProcessCallbacks.onComplete!(executionId, executionInfo);
              if (result instanceof Promise) {
                await result;
              }
            } catch (callbackError) {
              // コールバックエラーは内部ログに記録のみ
              // console.error('Adaptive background process completion callback error:', callbackError);
            }
          });
        }
      }
    });

    childProcess.on('error', (error) => {
      clearTimeout(timeout);
      this.processes.delete(childProcess.pid!);
      const executionInfo = this.executions.get(executionId);
      if (executionInfo) {
        executionInfo.status = 'failed';
        executionInfo.completed_at = getCurrentTimestamp();
        
        if (executionInfo.started_at) {
          const startTime = new Date(executionInfo.started_at).getTime();
          executionInfo.execution_time_ms = Date.now() - startTime;
        }
        
        this.executions.set(executionId, executionInfo);
        
        // adaptive modeバックグラウンドプロセスエラーのコールバック呼び出し
        if (this.backgroundProcessCallbacks.onError) {
          setImmediate(async () => {
            try {
              const result = this.backgroundProcessCallbacks.onError!(executionId, executionInfo, error);
              if (result instanceof Promise) {
                await result;
              }
            } catch (callbackError) {
              // コールバックエラーは内部ログに記録のみ
              // console.error('Adaptive background process error callback error:', callbackError);
            }
          });
        }
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
      cwd: this.resolveWorkingDirectory(options.workingDirectory),
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
          // ファイル保存失敗は重要なエラーとしてログに記録し、実行情報に含める
          console.error(`[CRITICAL] Failed to save output file for execution ${executionId}:`, error);
          executionInfo.message = `Output file save failed: ${error instanceof Error ? error.message : String(error)}`;
        }

        this.executions.set(executionId, executionInfo);
        
        // detachedプロセス正常終了のコールバック呼び出し
        if (this.backgroundProcessCallbacks.onComplete) {
          setImmediate(async () => {
            try {
              const result = this.backgroundProcessCallbacks.onComplete!(executionId, executionInfo);
              if (result instanceof Promise) {
                await result;
              }
            } catch (callbackError) {
              // コールバックエラーは内部ログに記録のみ
              // console.error('Detached process completion callback error:', callbackError);
            }
          });
        }
      }
    });

    childProcess.on('error', (error) => {
      const executionInfo = this.executions.get(executionId);
      if (executionInfo) {
        executionInfo.status = 'failed';
        executionInfo.execution_time_ms = Date.now() - startTime;
        executionInfo.completed_at = getCurrentTimestamp();
        this.executions.set(executionId, executionInfo);
        
        // detachedプロセスエラーのコールバック呼び出し
        if (this.backgroundProcessCallbacks.onError) {
          setImmediate(async () => {
            try {
              const result = this.backgroundProcessCallbacks.onError!(executionId, executionInfo, error);
              if (result instanceof Promise) {
                await result;
              }
            } catch (callbackError) {
              // コールバックエラーは内部ログに記録のみ
              // console.error('Detached process error callback error:', callbackError);
            }
          });
        }
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
    if (!this.fileManager) {
      // FileManagerが利用できない場合は、従来の方法でファイルを保存
      const outputFileId = generateId();
      const filePath = path.join(this.outputDir, `${outputFileId}.json`);

      const outputData = {
        execution_id: executionId,
        stdout,
        stderr,
        created_at: getCurrentTimestamp(),
      };

      await fs.writeFile(filePath, JSON.stringify(outputData, null, 2), 'utf-8');
      return outputFileId;
    }

    // FileManagerを使用して出力ファイルを作成
    const combinedOutput = stdout + (stderr ? '\n--- STDERR ---\n' + stderr : '');
    return await this.fileManager.createOutputFile(combinedOutput, executionId);
  }

  /**
   * 出力状態の詳細情報を設定するヘルパー関数
   * Issue #14: Enhanced guidance messages for adaptive mode transitions
   * 改善: outputTruncated の代わりに reason ベースで状態を判定
   */
  private setOutputStatus(
    executionInfo: ExecutionInfo, 
    actuallyTruncated: boolean, // 実際に出力が切り捨てられたか
    reason: OutputTruncationReason,
    outputId?: string
  ): void {
    // reasonに基づいて出力状態を設定
    const needsGuidance = !!outputId; // output_idがあれば常にガイダンスを提供
    
    // 後方互換性のため outputTruncated を設定
    executionInfo.output_truncated = actuallyTruncated || reason === 'timeout' || reason === 'background_transition';
    
    // Issue #14: バックグラウンド移行とタイムアウトは特別扱い
    if (reason === 'background_transition') {
      executionInfo.truncation_reason = reason;
      executionInfo.output_status = {
        complete: false, // バックグラウンド実行中は未完了
        reason: reason,
        available_via_output_id: !!outputId,
        recommended_action: outputId ? 'use_read_execution_output' : undefined
      };

      executionInfo.message = 'Command moved to background execution. Use process_list to monitor progress.';
      executionInfo.next_steps = [
        'Use process_list to check status', 
        'Use read_execution_output when completed',
        'Use output_id for real-time pipeline processing'
      ];
      if (needsGuidance) {
        executionInfo.guidance = {
          pipeline_usage: `Background process active. Use "input_output_id": "${outputId}" for real-time processing`,
          suggested_commands: [
            'tail -f equivalent using input_output_id for live monitoring',
            'grep for real-time log filtering',
            'awk for live data extraction and formatting'
          ],
          background_processing: {
            status_check: 'Use process_get_execution for detailed status',
            monitoring: 'Output_id supports real-time streaming while process runs'
          }
        };
      }
      return;
    }
    
    if (reason === 'timeout') {
      executionInfo.truncation_reason = reason;
      executionInfo.output_status = {
        complete: false, // タイムアウトは未完了
        reason: reason,
        available_via_output_id: !!outputId,
        recommended_action: outputId ? 'use_read_execution_output' : undefined
      };

      executionInfo.message = `Command timed out. ${outputId ? 'Use read_execution_output with output_id for complete results.' : 'Partial output available.'}`;
      if (needsGuidance) {
        executionInfo.next_steps = [
          'Use read_execution_output to get complete output',
          'Use output_id for pipeline processing with grep/sed/awk commands'
        ];
        executionInfo.guidance = {
          pipeline_usage: `Use "input_output_id": "${outputId}" parameter for further processing`,
          suggested_commands: [
            'grep pattern search using input_output_id',
            'sed text transformations using input_output_id',
            'awk data processing using input_output_id'
          ]
        };
      }
      return;
    }
    
    // 実際に出力が切り捨てられた場合
    if (actuallyTruncated) {
      executionInfo.truncation_reason = reason;
      executionInfo.output_status = {
        complete: false,
        reason: reason,
        available_via_output_id: !!outputId,
        recommended_action: outputId ? 'use_read_execution_output' : undefined
      };

      // 状況に応じたメッセージとアクションの設定
      switch (reason) {
        case 'size_limit':
          executionInfo.message = `Output exceeded size limit. ${outputId ? 'Complete output available via output_id.' : 'Output was truncated.'}`;
          if (needsGuidance) {
            executionInfo.next_steps = [
              'Use read_execution_output to get complete output',
              'Use output_id for streaming pipeline processing'
            ];
            executionInfo.guidance = {
              pipeline_usage: `Large output detected. Use "input_output_id": "${outputId}" for efficient processing`,
              suggested_commands: [
                'head/tail for output sampling using input_output_id',
                'grep for pattern matching without loading full output',
                'wc for counting lines/words/bytes efficiently'
              ]
            };
          }
          break;
        default:
          executionInfo.message = `Output truncated due to ${reason}. ${outputId ? 'Complete output may be available via output_id.' : ''}`;
          if (needsGuidance) {
            executionInfo.next_steps = [
              'Use read_execution_output to get complete output',
              'Use output_id for pipeline processing'
            ];
            executionInfo.guidance = {
              pipeline_usage: `Use "input_output_id": "${outputId}" parameter for further processing`,
              suggested_commands: [
                'grep for pattern searching',
                'sed for text transformations',
                'awk for data processing'
              ]
            };
          }
      }
    } else {
      // 完了した場合（切り捨てなし）
      executionInfo.output_status = {
        complete: true,
        available_via_output_id: !!outputId
      };
      
      // Issue #14: Add guidance even for complete outputs to promote pipeline usage
      if (needsGuidance) {
        executionInfo.guidance = {
          pipeline_usage: `Output saved. Use "input_output_id": "${outputId}" for further processing`,
          suggested_commands: [
            'grep for pattern searching',
            'sed for text transformations', 
            'awk for data processing and formatting'
          ]
        };
      }
    }
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

  // ワーキングディレクトリ管理
  setDefaultWorkingDirectory(workingDirectory: string): {
    success: boolean;
    previous_working_directory: string;
    new_working_directory: string;
    working_directory_changed: boolean;
  } {
    const previousWorkdir = this.defaultWorkingDirectory;
    
    // ディレクトリの検証
    if (!this.isAllowedWorkingDirectory(workingDirectory)) {
      throw new Error(`Working directory not allowed: ${workingDirectory}`);
    }

    this.defaultWorkingDirectory = workingDirectory;
    
    return {
      success: true,
      previous_working_directory: previousWorkdir,
      new_working_directory: workingDirectory,
      working_directory_changed: previousWorkdir !== workingDirectory,
    };
  }

  getDefaultWorkingDirectory(): string {
    return this.defaultWorkingDirectory;
  }

  getAllowedWorkingDirectories(): string[] {
    return [...this.allowedWorkingDirectories];
  }

  private isAllowedWorkingDirectory(workingDirectory: string): boolean {
    // パスの正規化を行って比較
    const normalizedPath = path.resolve(workingDirectory);
    return this.allowedWorkingDirectories.some(allowedDir => {
      const normalizedAllowed = path.resolve(allowedDir);
      return normalizedPath === normalizedAllowed || normalizedPath.startsWith(normalizedAllowed + path.sep);
    });
  }

  private resolveWorkingDirectory(workingDirectory?: string): string {
    const resolved = workingDirectory || this.defaultWorkingDirectory;
    
    if (!this.isAllowedWorkingDirectory(resolved)) {
      throw new Error(`Working directory not allowed: ${resolved}`);
    }
    
    return resolved;
  }
}
