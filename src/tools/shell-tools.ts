import {
  ShellExecuteParams,
  ShellGetExecutionParams,
  ShellSetDefaultWorkdirParams,
  ProcessListParams,
  ProcessKillParams,
  ProcessMonitorParams,
  FileListParams,
  FileReadParams,
  FileDeleteParams,
  TerminalCreateParams,
  TerminalListParams,
  TerminalGetParams,
  TerminalInputParams,
  TerminalOutputParams,
  TerminalResizeParams,
  TerminalCloseParams,
  SecuritySetRestrictionsParams,
  MonitoringGetStatsParams,
  CleanupSuggestionsParams,
  AutoCleanupParams,
} from '../types/schemas.js';
import { TerminalOperateParams } from '../types/quick-schemas.js';
import { ProcessManager } from '../core/process-manager.js';
import { TerminalManager } from '../core/terminal-manager.js';
import { FileManager } from '../core/file-manager.js';
import { MonitoringManager } from '../core/monitoring-manager.js';
import { SecurityManager } from '../security/manager.js';
import { MCPShellError } from '../utils/errors.js';

export class ShellTools {
  constructor(
    private processManager: ProcessManager,
    private terminalManager: TerminalManager,
    private fileManager: FileManager,
    private monitoringManager: MonitoringManager,
    private securityManager: SecurityManager
  ) {}

  // Shell Operations
  async executeShell(params: ShellExecuteParams) {
    try {
      // セキュリティチェック
      this.securityManager.auditCommand(params.command, params.working_directory);
      this.securityManager.validateExecutionTime(params.timeout_seconds);

      const executionOptions: any = {
        command: params.command,
        executionMode: params.execution_mode,
        timeoutSeconds: params.timeout_seconds,
        foregroundTimeoutSeconds: params.foreground_timeout_seconds,
        maxOutputSize: params.max_output_size,
        captureStderr: params.capture_stderr,
        returnPartialOnTimeout: params.return_partial_on_timeout,
      };

      // オプショナルなプロパティを追加（undefinedでない場合のみ）
      if (params.working_directory !== undefined) {
        executionOptions.workingDirectory = params.working_directory;
      }
      if (params.environment_variables !== undefined) {
        executionOptions.environmentVariables = params.environment_variables;
      }
      if (params.input_data !== undefined) {
        executionOptions.inputData = params.input_data;
      }
      if (params.input_output_id !== undefined) {
        executionOptions.inputOutputId = params.input_output_id;
      }
      if (params.session_id !== undefined) {
        executionOptions.sessionId = params.session_id;
      }
      if (params.create_terminal !== undefined) {
        executionOptions.createTerminal = params.create_terminal;
      }
      if (params.terminal_shell !== undefined) {
        executionOptions.terminalShell = params.terminal_shell;
      }
      if (params.terminal_dimensions !== undefined) {
        executionOptions.terminalDimensions = params.terminal_dimensions;
      }

      const executionInfo = await this.processManager.executeCommand(executionOptions);

      return executionInfo;
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }

  async getExecution(params: ShellGetExecutionParams) {
    try {
      const executionInfo = this.processManager.getExecution(params.execution_id);
      if (!executionInfo) {
        throw new MCPShellError(
          'RESOURCE_001',
          `Execution with ID ${params.execution_id} not found`,
          'RESOURCE'
        );
      }
      return executionInfo;
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }

  // Process Management
  async listProcesses(params: ProcessListParams) {
    try {
      // Convert status filter - handle different enum values
      let statusFilter = params.status_filter;
      if (statusFilter === 'all') {
        statusFilter = undefined;
      }

      const listOptions: any = {
        limit: params.limit,
        offset: params.offset,
      };

      if (statusFilter !== undefined) {
        listOptions.status = statusFilter;
      }
      if (params.command_pattern !== undefined) {
        listOptions.commandPattern = params.command_pattern;
      }
      if (params.session_id !== undefined) {
        listOptions.sessionId = params.session_id;
      }

      const result = this.processManager.listExecutions(listOptions);

      return {
        processes: result.executions,
        total_count: result.total,
        filtered_count: result.executions.length,
      };
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }

  async killProcess(params: ProcessKillParams) {
    try {
      const result = await this.processManager.killProcess(
        params.process_id,
        params.signal,
        params.force
      );

      return {
        success: result.success,
        process_id: params.process_id,
        signal_sent: result.signal_sent,
        exit_code: result.exit_code,
        message: result.message,
      };
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }

  async monitorProcess(params: ProcessMonitorParams) {
    try {
      const monitorInfo = this.monitoringManager.startProcessMonitor(
        params.process_id,
        params.monitor_interval_ms,
        params.include_metrics
      );

      return monitorInfo;
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }

  // File Operations
  async listFiles(params: FileListParams) {
    try {
      const listOptions: any = {
        limit: params.limit,
      };

      if (params.output_type !== undefined) {
        listOptions.outputType = params.output_type;
      }
      if (params.execution_id !== undefined) {
        listOptions.executionId = params.execution_id;
      }
      if (params.name_pattern !== undefined) {
        listOptions.namePattern = params.name_pattern;
      }

      const result = this.fileManager.listFiles(listOptions);

      return result;
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }

  async readFile(params: FileReadParams) {
    try {
      const result = await this.fileManager.readFile(
        params.output_id,
        params.offset,
        params.size,
        params.encoding as BufferEncoding
      );

      return result;
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }

  async deleteFiles(params: FileDeleteParams) {
    try {
      const result = await this.fileManager.deleteFiles(params.output_ids, params.confirm);

      return result;
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }

  // Terminal Management
  async createTerminal(params: TerminalCreateParams) {
    try {
      const terminalOptions: any = {
        shellType: params.shell_type,
        dimensions: params.dimensions,
        autoSaveHistory: params.auto_save_history,
      };

      if (params.session_name !== undefined) {
        terminalOptions.sessionName = params.session_name;
      }
      if (params.working_directory !== undefined) {
        terminalOptions.workingDirectory = params.working_directory;
      }
      if (params.environment_variables !== undefined) {
        terminalOptions.environmentVariables = params.environment_variables;
      }

      const terminalInfo = await this.terminalManager.createTerminal(terminalOptions);

      return terminalInfo;
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }

  async listTerminals(params: TerminalListParams) {
    try {
      const listOptions: any = {
        limit: params.limit,
      };

      if (params.session_name_pattern !== undefined) {
        listOptions.sessionNamePattern = params.session_name_pattern;
      }
      if (params.status_filter !== undefined) {
        listOptions.statusFilter = params.status_filter;
      }

      const result = this.terminalManager.listTerminals(listOptions);

      return result;
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }

  async getTerminal(params: TerminalGetParams) {
    try {
      const terminalInfo = await this.terminalManager.getTerminal(params.terminal_id);
      return terminalInfo;
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }

  async sendTerminalInput(params: TerminalInputParams) {
    try {
      const result = await this.terminalManager.sendInput(
        params.terminal_id,
        params.input,
        params.execute,
        params.control_codes,
        params.raw_bytes,
        params.send_to
      );

      return {
        success: result.success,
        input_sent: params.input,
        control_codes_enabled: params.control_codes || false,
        raw_bytes_mode: params.raw_bytes || false,
        program_guard: result.guard_check,
        timestamp: result.timestamp,
      };
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }

  async getTerminalOutput(params: TerminalOutputParams) {
    try {
      const result = await this.terminalManager.getOutput(
        params.terminal_id,
        params.start_line,
        params.line_count,
        params.include_ansi,
        params.include_foreground_process
      );

      const response: any = {
        terminal_id: params.terminal_id,
        output: result.output,
        line_count: result.line_count,
        total_lines: result.total_lines,
        has_more: result.has_more,
        start_line: result.start_line,
        next_start_line: result.next_start_line,
      };

      if (params.include_foreground_process) {
        response.foreground_process = result.foreground_process;
      }

      return response;
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }

  async resizeTerminal(params: TerminalResizeParams) {
    try {
      const result = this.terminalManager.resizeTerminal(params.terminal_id, params.dimensions);

      return {
        success: result.success,
        terminal_id: params.terminal_id,
        dimensions: params.dimensions,
        updated_at: result.updated_at,
      };
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }

  async closeTerminal(params: TerminalCloseParams) {
    try {
      const result = this.terminalManager.closeTerminal(params.terminal_id, params.save_history);

      return result;
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }

  // Security & Monitoring
  async setSecurityRestrictions(params: SecuritySetRestrictionsParams) {
    try {
      const restrictionParams: any = {
        enable_network: params.enable_network,
      };

      if (params.allowed_commands !== undefined) {
        restrictionParams.allowed_commands = params.allowed_commands;
      }
      if (params.blocked_commands !== undefined) {
        restrictionParams.blocked_commands = params.blocked_commands;
      }
      if (params.allowed_directories !== undefined) {
        restrictionParams.allowed_directories = params.allowed_directories;
      }
      if (params.max_execution_time !== undefined) {
        restrictionParams.max_execution_time = params.max_execution_time;
      }
      if (params.max_memory_mb !== undefined) {
        restrictionParams.max_memory_mb = params.max_memory_mb;
      }

      const restrictions = this.securityManager.setRestrictions(restrictionParams);

      return {
        restriction_id: restrictions.restriction_id,
        active: restrictions.active,
        configured_at: restrictions.configured_at,
      };
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }

  async getMonitoringStats(params: MonitoringGetStatsParams) {
    try {
      let stats = this.monitoringManager.getSystemStats(params.time_range_minutes);

      // 要求されたメトリクスのみを含める
      if (params.include_metrics) {
        const filteredStats: any = {
          collected_at: stats.collected_at,
        };

        for (const metric of params.include_metrics) {
          switch (metric) {
            case 'processes':
              filteredStats.active_processes = stats.active_processes;
              break;
            case 'terminals':
              filteredStats.active_terminals = stats.active_terminals;
              break;
            case 'files':
              filteredStats.total_files = stats.total_files;
              break;
            case 'system':
              filteredStats.system_load = stats.system_load;
              filteredStats.memory_usage = stats.memory_usage;
              filteredStats.uptime_seconds = stats.uptime_seconds;
              break;
          }
        }

        stats = filteredStats;
      }

      return stats;
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }

  async setDefaultWorkingDirectory(params: ShellSetDefaultWorkdirParams) {
    try {
      const result = this.processManager.setDefaultWorkingDirectory(params.working_directory);
      
      return {
        success: result.success,
        previous_working_directory: result.previous_working_directory,
        new_working_directory: result.new_working_directory,
        working_directory_changed: result.working_directory_changed,
        default_working_directory: this.processManager.getDefaultWorkingDirectory(),
        allowed_working_directories: this.processManager.getAllowedWorkingDirectories(),
      };
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }

  // Issue #15: クリーンアップ提案機能
  async getCleanupSuggestions(params?: CleanupSuggestionsParams) {
    try {
      const options: Parameters<typeof this.fileManager.getCleanupSuggestions>[0] = {};
      
      if (params?.max_size_mb !== undefined) options.maxSizeMB = params.max_size_mb;
      if (params?.max_age_hours !== undefined) options.maxAgeHours = params.max_age_hours;
      if (params?.include_warnings !== undefined) options.includeWarnings = params.include_warnings;

      const result = await this.fileManager.getCleanupSuggestions(options);
      return result;
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }

  // Issue #15: 自動クリーンアップ実行機能
  async performAutoCleanup(params?: AutoCleanupParams) {
    try {
      const options: Parameters<typeof this.fileManager.performAutoCleanup>[0] = {};
      
      if (params?.max_age_hours !== undefined) options.maxAgeHours = params.max_age_hours;
      if (params?.dry_run !== undefined) options.dryRun = params.dry_run;
      if (params?.preserve_recent !== undefined) options.preserveRecent = params.preserve_recent;

      const result = await this.fileManager.performAutoCleanup(options);
      return result;
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }

  // 統合ターミナル操作 (create + send_input + get_output を統合)
  async terminalOperate(params: TerminalOperateParams) {
    try {
      let terminalId = params.terminal_id;
      let terminalInfo = null;
      let inputRejected = false;
      let rejectionReason = "";
      let unreadOutput: any = null;

      // 1. ターミナルの準備 (新規作成 or 既存利用)
      if (!terminalId) {
        if (!params.command) {
          throw new Error('Either terminal_id or command must be provided');
        }
        
        // 新規ターミナル作成
        const createOptions: any = {
          shellType: params.shell_type || 'bash',
          dimensions: params.dimensions || { width: 120, height: 30 },
          autoSaveHistory: true,
        };

        if (params.session_name) createOptions.sessionName = params.session_name;
        if (params.working_directory) createOptions.workingDirectory = params.working_directory;
        if (params.environment_variables) createOptions.environmentVariables = params.environment_variables;

        terminalInfo = await this.terminalManager.createTerminal(createOptions);
        terminalId = terminalInfo.terminal_id;

        // 作成後にコマンドを自動実行
        if (params.command) {
          await this.terminalManager.sendInput(
            terminalId,
            params.command,
            true, // execute
            params.control_codes || false,
            false, // raw_bytes
            params.send_to // program guard
          );
        }
      } else {
        // 既存ターミナル使用
        terminalInfo = await this.terminalManager.getTerminal(terminalId);
        
        // dimensionsが指定されている場合、現在のサイズと比較してリサイズ
        if (params.dimensions) {
          const currentDimensions = terminalInfo.dimensions;
          const newDimensions = params.dimensions;
          
          if (currentDimensions.width !== newDimensions.width || 
              currentDimensions.height !== newDimensions.height) {
            // サイズが異なる場合はリサイズ実行
            await this.terminalManager.resizeTerminal(terminalId, newDimensions);
            // 最新のターミナル情報を再取得
            terminalInfo = await this.terminalManager.getTerminal(terminalId);
          }
        }
        
        // inputまたはcommandが指定されていれば送信（未読出力チェック付き）
        const inputToSend = params.input || params.command;
        
        if (inputToSend) {
          // 制御コード送信時は自動的にforce_inputをtrueにする（Ctrl+C等の緊急操作のため）
          const effectiveForceInput = params.force_input || params.control_codes;
          
          // 未読出力チェック（force_inputまたはcontrol_codesがfalseの場合のみ）
          if (!effectiveForceInput) {
            const unreadCheck = await this.terminalManager.getOutput(
              terminalId,
              undefined, // start_lineはデフォルト（連続読み取り）
              1000, // 大きめの値で未読データを全取得
              params.include_ansi || false,
              false // include_foreground_process
            );
            
            // 未読出力がある場合は入力を拒否（ただし処理は続行）
            if (unreadCheck.output && unreadCheck.output.trim().length > 0) {
              inputRejected = true;
              rejectionReason = "Unread output exists. Read output first or use force_input=true to override.";
              unreadOutput = unreadCheck;
            }
          }
          
          // 制約に引っかからなかった場合のみ入力送信
          if (!inputRejected) {
            await this.terminalManager.sendInput(
              terminalId,
              inputToSend,
              params.execute !== false, // デフォルトtrue
              params.control_codes || false,
              false, // raw_bytes
              params.send_to // program guard
            );
          }
        }
      }

      // 2. 遅延処理（コマンド完了待ち）
      if (params.output_delay_ms > 0) {
        await new Promise(resolve => setTimeout(resolve, params.output_delay_ms));
      }

      // 3. 出力取得
      let output = null;
      if (params.get_output !== false) {
        const outputResult = await this.terminalManager.getOutput(
          terminalId,
          undefined, // start_lineはデフォルト（連続読み取り）
          params.output_lines || 20,
          params.include_ansi || false,
          false // include_foreground_process
        );
        output = outputResult;
      }

      // 4. レスポンス構築
      const response: any = {
        terminal_id: terminalId,
        success: !inputRejected, // 入力が拒否された場合はfalse
      };

      // 入力拒否情報を追加
      if (inputRejected) {
        response.input_rejected = true;
        response.reason = rejectionReason;
        if (unreadOutput) {
          response.unread_output = unreadOutput.output;
          response.unread_output_info = {
            line_count: unreadOutput.line_count,
            total_lines: unreadOutput.total_lines,
            has_more: unreadOutput.has_more,
            start_line: unreadOutput.start_line,
            next_start_line: unreadOutput.next_start_line,
          };
        }
      }

      if (params.return_terminal_info !== false && terminalInfo) {
        response.terminal_info = terminalInfo;
      }

      if (output) {
        response.output = output.output;
        response.output_info = {
          line_count: output.line_count,
          total_lines: output.total_lines,
          has_more: output.has_more,
          start_line: output.start_line,
          next_start_line: output.next_start_line,
        };
      }

      // 応答レベルに応じて情報を調整
      if (params.response_level === 'minimal') {
        return {
          terminal_id: terminalId,
          success: true,
          output: output?.output || null,
        };
      } else if (params.response_level === 'full') {
        // フル情報を含める（すでにresponseに含まれている）
      }

      return response;
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }
}
