import { ShellType, Dimensions } from '../types/index.js';
// ターミナル出力レスポンス型（クラス全体で利用可能にする）
export interface TerminalOutputResponse {
  terminal_id: string;
  output: string;
  line_count: number;
  total_lines: number;
  has_more: boolean;
  start_line: number;
  next_start_line: number;
  foreground_process?: unknown;
}
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
  CommandHistoryQueryParams,
} from '../types/schemas.js';
import { TerminalOperateParams } from '../types/quick-schemas.js';
import { ProcessManager, ExecutionOptions } from '../core/process-manager.js';
import { TerminalManager } from '../core/terminal-manager.js';
import { FileManager } from '../core/file-manager.js';
import { MonitoringManager } from '../core/monitoring-manager.js';
import { SecurityManager } from '../security/manager.js';
import { CommandHistoryManager } from '../core/enhanced-history-manager.js';
import { TerminalOptions } from '../core/terminal-manager.js';
import { MCPShellError } from '../utils/errors.js';

// ...existing code...

// Safety evaluation result interface
interface SafetyEvaluationResult {
  evaluation_result: 'ALLOW' | 'DENY' | 'NEED_USER_CONFIRM' | 'NEED_ASSISTANT_CONFIRM' | 'NEED_MORE_HISTORY';
  basic_classification?: string;
  reasoning: string;
  requires_confirmation: boolean;
  suggested_alternatives?: string[];
  llm_evaluation_used?: boolean;
  context_analysis?: unknown;
}

// ...existing code...

export class ShellTools {
  constructor(
    private processManager: ProcessManager,
    private terminalManager: TerminalManager,
    private fileManager: FileManager,
    private monitoringManager: MonitoringManager,
    private securityManager: SecurityManager,
    private historyManager: CommandHistoryManager
  ) {}

  // Shell Operations
  async executeShell(params: ShellExecuteParams) {
    try {
      // Enhanced security evaluation (if enabled)
      const workingDir =
        params.working_directory || this.processManager.getDefaultWorkingDirectory();
      let safetyEvaluation: SafetyEvaluationResult | null = null;

      if (this.securityManager.isEnhancedModeEnabled()) {
        // Evaluate command safety with enhanced evaluator
        safetyEvaluation = await this.securityManager.evaluateCommandSafetyByEnhancedEvaluator(
          params.command,
          workingDir,
          params.comment,
          params.force_user_confirm // Pass force_user_confirm flag
        );

        // Handle evaluation results with strict safety guards
        if (safetyEvaluation?.evaluation_result === 'DENY') {
          throw new Error(`Command denied: ${safetyEvaluation.reasoning}`);
        }

        // For NEED_USER_CONFIRM, return evaluation info without executing
        // User can review suggested alternatives and re-run if appropriate
        if (safetyEvaluation?.evaluation_result === 'NEED_USER_CONFIRM') {
          return {
            status: 'need_user_confirm',
            command: params.command,
            working_directory: workingDir,
            safety_evaluation: {
              evaluation_result: safetyEvaluation.evaluation_result,
              reasoning: safetyEvaluation.reasoning,
              basic_classification: safetyEvaluation.basic_classification,
              requires_confirmation: safetyEvaluation.requires_confirmation,
              suggested_alternatives: safetyEvaluation.suggested_alternatives,
              llm_evaluation_used: safetyEvaluation.llm_evaluation_used || false,
              context_analysis: safetyEvaluation.context_analysis,
            },
            message:
              'Command requires user confirmation before execution. Please review the suggested alternatives and re-run if appropriate.',
          };
        }

        // For NEED_ASSISTANT_CONFIRM, return evaluation info without executing
        // Assistant should review and provide more context
        if (safetyEvaluation?.evaluation_result === 'NEED_ASSISTANT_CONFIRM') {
          return {
            status: 'need_assistant_confirm',
            command: params.command,
            working_directory: workingDir,
            safety_evaluation: {
              evaluation_result: safetyEvaluation.evaluation_result,
              reasoning: safetyEvaluation.reasoning,
              basic_classification: safetyEvaluation.basic_classification,
              requires_confirmation: safetyEvaluation.requires_confirmation,
              suggested_alternatives: safetyEvaluation.suggested_alternatives,
              llm_evaluation_used: safetyEvaluation.llm_evaluation_used || false,
              context_analysis: safetyEvaluation.context_analysis,
            },
            message:
              'Command requires assistant confirmation before execution. Assistant should provide more context.',
          };
        }

        // For NEED_MORE_HISTORY, return evaluation info without executing
        // System needs more context to make a decision
        if (safetyEvaluation?.evaluation_result === 'NEED_MORE_HISTORY') {
          return {
            status: 'need_more_history',
            command: params.command,
            working_directory: workingDir,
            safety_evaluation: {
              evaluation_result: safetyEvaluation.evaluation_result,
              reasoning: safetyEvaluation.reasoning,
              basic_classification: safetyEvaluation.basic_classification,
              requires_confirmation: safetyEvaluation.requires_confirmation,
              suggested_alternatives: safetyEvaluation.suggested_alternatives,
              llm_evaluation_used: safetyEvaluation.llm_evaluation_used || false,
              context_analysis: safetyEvaluation.context_analysis,
            },
            message:
              'Command evaluation requires more historical context. Please provide additional context.',
          };
        }

        // CRITICAL SAFETY GUARD: Only execute if explicitly ALLOWED
        if (safetyEvaluation?.evaluation_result !== 'ALLOW') {
          throw new Error(
            `Command execution blocked: evaluation result '${safetyEvaluation?.evaluation_result}' is not ALLOW. Reasoning: ${safetyEvaluation?.reasoning}`
          );
        }
      }

      // Traditional security checks (still performed)
      this.securityManager.auditCommand(params.command, params.working_directory);
      this.securityManager.validateExecutionTime(params.timeout_seconds);

      const executionOptions: ExecutionOptions = {
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

      // Add command to history
      try {
        const safetyClassification = this.securityManager.analyzeCommandSafety(params.command);
        await this.historyManager.addHistoryEntry({
          command: params.command,
          working_directory:
            params.working_directory || this.processManager.getDefaultWorkingDirectory(),
          was_executed: true,
          resubmission_count: 0,
          safety_classification: safetyClassification.classification,
          execution_status: executionInfo.status,
          output_summary: `Exit code: ${executionInfo.exit_code}, Duration: ${executionInfo.execution_time_ms}ms, Output size: ${(executionInfo.stdout?.length || 0) + (executionInfo.stderr?.length || 0)} bytes`,
        });
      } catch (historyError) {
        // Log history error but don't fail the execution
        console.warn('Failed to add command to history:', historyError);
      }

      // Include safety evaluation in response if available
      const response: Record<string, unknown> = { ...executionInfo };
      if (safetyEvaluation) {
        response['safety_evaluation'] = {
          evaluation_result: safetyEvaluation.evaluation_result,
          reasoning: safetyEvaluation.reasoning,
          basic_classification: safetyEvaluation.basic_classification,
          requires_confirmation: safetyEvaluation.requires_confirmation,
          suggested_alternatives: safetyEvaluation.suggested_alternatives,
          llm_evaluation_used: safetyEvaluation.llm_evaluation_used || false,
          context_analysis: safetyEvaluation.context_analysis,
        };
      }

      return response;
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

      const listOptions: Record<string, unknown> = {
        limit: params.limit,
        offset: params.offset,
      };

      if (statusFilter !== undefined) {
        listOptions['status'] = statusFilter;
      }
      if (params.command_pattern !== undefined) {
        listOptions['commandPattern'] = params.command_pattern;
      }
      if (params.session_id !== undefined) {
        listOptions['sessionId'] = params.session_id;
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
      const listOptions: Record<string, unknown> = {
        limit: params.limit,
      };

      if (params.output_type !== undefined) {
        listOptions['outputType'] = params.output_type;
      }
      if (params.execution_id !== undefined) {
        listOptions['executionId'] = params.execution_id;
      }
      if (params.name_pattern !== undefined) {
        listOptions['namePattern'] = params.name_pattern;
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
  // ...existing code...
  async createTerminal(params: TerminalCreateParams) {
    try {
      const terminalOptions: TerminalOptions = {
        shellType: params.shell_type as ShellType,
        dimensions: params.dimensions as Dimensions,
        autoSaveHistory: params.auto_save_history ?? false,
        sessionName: params.session_name ?? '',
        workingDirectory: params.working_directory,
        environmentVariables: params.environment_variables,
      };

      const terminalInfo = await this.terminalManager.createTerminal(terminalOptions);

      return terminalInfo;
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }

  async listTerminals(params: TerminalListParams) {
    try {
      const listOptions: {
        sessionNamePattern?: string;
        statusFilter?: 'active' | 'idle' | 'closed' | 'all';
        limit?: number;
      } = {};
      if (params.limit !== undefined) {
        listOptions.limit = params.limit;
      }
      if (params.session_name_pattern !== undefined) {
        listOptions.sessionNamePattern = params.session_name_pattern;
      }
      if (params.status_filter !== undefined) {
        listOptions.statusFilter = params.status_filter as 'active' | 'idle' | 'closed' | 'all';
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

      const response: TerminalOutputResponse = {
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
      const restrictionParams: Record<string, unknown> = {
        enable_network: params.enable_network,
      };

      if (params.allowed_commands !== undefined) {
        restrictionParams['allowed_commands'] = params.allowed_commands;
      }
      if (params.blocked_commands !== undefined) {
        restrictionParams['blocked_commands'] = params.blocked_commands;
      }
      if (params.allowed_directories !== undefined) {
        restrictionParams['allowed_directories'] = params.allowed_directories;
      }
      if (params.max_execution_time !== undefined) {
        restrictionParams['max_execution_time'] = params.max_execution_time;
      }
      if (params.max_memory_mb !== undefined) {
        restrictionParams['max_memory_mb'] = params.max_memory_mb;
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
        const filteredStats: Record<string, unknown> = {
          collected_at: stats.collected_at,
        };

        for (const metric of params.include_metrics) {
          switch (metric) {
            case 'processes':
              filteredStats['active_processes'] = stats.active_processes;
              break;
            case 'terminals':
              filteredStats['active_terminals'] = stats.active_terminals;
              break;
            case 'files':
              filteredStats['total_files'] = stats.total_files;
              break;
            case 'system':
              filteredStats['system_load'] = stats.system_load;
              filteredStats['memory_usage'] = stats.memory_usage;
              filteredStats['uptime_seconds'] = stats.uptime_seconds;
              break;
          }
        }

        return filteredStats;
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
      let rejectionReason = '';
      let unreadOutput: {
        output: string;
        line_count: number;
        total_lines: number;
        has_more: boolean;
        start_line: number;
        next_start_line: number;
        foreground_process?: unknown;
      } | null = null;

      // 1. ターミナルの準備 (新規作成 or 既存利用)
      if (!terminalId) {
        if (!params.command) {
          throw new Error('Either terminal_id or command must be provided');
        }

        // 新規ターミナル作成
        const createOptions: TerminalOptions = {
          shellType: params.shell_type || 'bash',
          dimensions: params.dimensions || { width: 120, height: 30 },
          autoSaveHistory: true,
          sessionName: params.session_name ?? undefined,
          workingDirectory: params.working_directory ?? undefined,
          environmentVariables: params.environment_variables ?? undefined,
        };

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

          if (
            currentDimensions.width !== newDimensions.width ||
            currentDimensions.height !== newDimensions.height
          ) {
            // サイズが異なる場合はリサイズ実行
            await this.terminalManager.resizeTerminal(terminalId, newDimensions);
            // 最新のターミナル情報を再取得
            terminalInfo = await this.terminalManager.getTerminal(terminalId);
          }
        }

        // inputまたはcommandが指定されていれば送信（未読出力チェック付き）
        const inputToSend = params.input || params.command;
        if (typeof inputToSend === 'string' && inputToSend.length > 0) {
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
            if (unreadCheck.output && unreadCheck.output.trim().length > 0) {
              inputRejected = true;
              rejectionReason =
                'Unread output exists. Read output first or use force_input=true to override.';
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
        await new Promise((resolve) => setTimeout(resolve, params.output_delay_ms));
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
      const response: Record<string, unknown> = {
        terminal_id: terminalId,
        success: !inputRejected, // 入力が拒否された場合はfalse
      };

      // 入力拒否情報を追加
      if (inputRejected) {
        response['input_rejected'] = true;
        response['reason'] = rejectionReason;
        if (unreadOutput) {
          response['unread_output'] = unreadOutput.output;
          response['unread_output_info'] = {
            line_count: unreadOutput.line_count,
            total_lines: unreadOutput.total_lines,
            has_more: unreadOutput.has_more,
            start_line: unreadOutput.start_line,
            next_start_line: unreadOutput.next_start_line,
          };
        }
      }

      if (params.return_terminal_info !== false && terminalInfo) {
        response['terminal_info'] = terminalInfo;
      }

      if (output) {
        response['output'] = output.output;
        response['output_info'] = {
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

  // Command History Management
  async queryCommandHistory(params: CommandHistoryQueryParams) {
    try {
      // Handle individual entry reference
      if (params.entry_id) {
        const entries = this.historyManager.searchHistory({
          limit: 1000, // Get all entries to search for the specific ID
        });

        const entry = entries.find((e) => e.execution_id === params.entry_id);
        if (!entry) {
          return {
            success: false,
            error: `Entry with ID ${params.entry_id} not found`,
          };
        }

        return {
          success: true,
          entry: params.include_full_details
            ? entry
            : {
                execution_id: entry.execution_id,
                command: entry.command,
                timestamp: entry.timestamp,
                working_directory: entry.working_directory,
                safety_classification: entry.safety_classification,
                was_executed: entry.was_executed,
                output_summary: entry.output_summary,
              },
        };
      }

      // Handle analytics
      if (params.analytics_type) {
        const stats = this.historyManager.getHistoryStats();

        switch (params.analytics_type) {
          case 'stats':
            return {
              success: true,
              analytics: {
                type: 'stats',
                total_entries: stats.totalEntries,
                entries_with_evaluation: stats.entriesWithEvaluation,
                entries_with_confirmation: stats.entriesWithConfirmation,
              },
            };
          case 'patterns':
            return {
              success: true,
              analytics: {
                type: 'patterns',
                confirmation_patterns: stats.confirmationPatterns,
              },
            };
          case 'top_commands':
            return {
              success: true,
              analytics: {
                type: 'top_commands',
                top_commands: stats.topCommands,
              },
            };
        }
      }

      // Handle search and pagination
      const searchQuery: Record<string, unknown> = {};

      if (params.command_pattern || params.query) {
        searchQuery['command'] = params.command_pattern || params.query;
      }
      if (params.working_directory) {
        searchQuery['working_directory'] = params.working_directory;
      }
      if (params.was_executed !== undefined) {
        searchQuery['was_executed'] = params.was_executed;
      }
      if (params.safety_classification) {
        searchQuery['safety_classification'] = params.safety_classification;
      }
      // Calculate pagination
      const offset = (params.page - 1) * params.page_size;
      searchQuery['limit'] = params.page_size + offset; // Get more to handle offset

      let results = this.historyManager.searchHistory(searchQuery);

      // Apply date filtering if specified
      if (params.date_from || params.date_to) {
        const fromDate = params.date_from ? new Date(params.date_from) : new Date(0);
        const toDate = params.date_to ? new Date(params.date_to) : new Date();

        results = results.filter((entry) => {
          const entryDate = new Date(entry.timestamp);
          return entryDate >= fromDate && entryDate <= toDate;
        });
      }

      // Apply pagination
      const totalEntries = results.length;
      const paginatedResults = results.slice(offset, offset + params.page_size);

      // Format results
      const entries = paginatedResults.map((entry) => {
        if (params.include_full_details) {
          return entry;
        } else {
          // Return metadata with IDs for external tool integration
          return {
            execution_id: entry.execution_id,
            command: entry.command,
            timestamp: entry.timestamp,
            working_directory: entry.working_directory,
            safety_classification: entry.safety_classification,
            llm_evaluation_result: entry.llm_evaluation_result,
            was_executed: entry.was_executed,
            resubmission_count: entry.resubmission_count,
            output_summary: entry.output_summary,
            // IDs for external tool integration
            ...(entry.was_executed && {
              // These can be used with process_get_execution and read_execution_output
              reference_note:
                'Use process_get_execution with execution_id for detailed execution info, or read_execution_output for full output',
            }),
          };
        }
      });

      return {
        success: true,
        entries,
        pagination: {
          page: params.page,
          page_size: params.page_size,
          total_entries: totalEntries,
          total_pages: Math.ceil(totalEntries / params.page_size),
          has_next: offset + params.page_size < totalEntries,
          has_previous: params.page > 1,
        },
      };
    } catch (error) {
      throw MCPShellError.fromError(error);
    }
  }
}
