import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod';

import { ProcessManager } from './core/process-manager.js';
import { TerminalManager } from './core/terminal-manager.js';
import { FileManager } from './core/file-manager.js';
import { MonitoringManager } from './core/monitoring-manager.js';
import { SecurityManager } from './security/manager.js';
import { ConfigManager } from './core/config-manager.js';
import { CommandHistoryManager } from './core/enhanced-history-manager.js';
import { ShellTools } from './tools/shell-tools.js';
import { logger } from './utils/helpers.js';
import { ExecutionInfo } from './types/index.js';

import {
  ShellExecuteParamsSchema,
  ShellGetExecutionParamsSchema,
  ShellSetDefaultWorkdirParamsSchema,
  FileListParamsSchema,
  FileReadParamsSchema,
  FileDeleteParamsSchema,
  TerminalListParamsSchema,
  TerminalGetParamsSchema,
  TerminalCloseParamsSchema,
  CleanupSuggestionsParamsSchema,
  AutoCleanupParamsSchema,
  CommandHistoryQueryParamsSchema,
} from './types/schemas.js';
import { TerminalOperateParamsSchema } from './types/quick-schemas.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { MCPShellError } from './utils/errors.js';

// Tools can be disabled by specifying a comma-separated list in the
// MCP_DISABLED_TOOLS environment variable. Disabled tools will not be
// advertised or executable.
const DISABLED_TOOLS: string[] = (process.env['MCP_DISABLED_TOOLS'] || '')
  .split(',')
  .map((t) => t.trim())
  .filter((t) => t.length > 0);

export class MCPShellServer {
  private server: Server;
  private processManager: ProcessManager;
  private terminalManager: TerminalManager;
  private fileManager: FileManager;
  private monitoringManager: MonitoringManager;
  private securityManager: SecurityManager;
  private configManager: ConfigManager;
  private commandHistoryManager: CommandHistoryManager;
  private shellTools: ShellTools;

  constructor() {
    this.server = new Server(
      {
        name: 'mcp-shell-server',
        version: '2.0.0',
      },
      {
        capabilities: {
          tools: {},
          logging: {}, // ログ通知機能を有効化
        },
      }
    );

    // マネージャーの初期化（FileManagerを最初に初期化）
    this.fileManager = new FileManager();
    this.configManager = new ConfigManager();
    this.processManager = new ProcessManager(50, '/tmp/mcp-shell-outputs', this.fileManager);
    this.terminalManager = new TerminalManager();
    this.monitoringManager = new MonitoringManager();
    this.securityManager = new SecurityManager();
    
    // Enhanced security configを取得してCommandHistoryManagerを初期化
    const enhancedConfig = this.configManager.getEnhancedSecurityConfig();
    this.commandHistoryManager = new CommandHistoryManager(enhancedConfig);
    
    // Load existing command history
    this.commandHistoryManager.loadHistory().catch(error => {
      console.warn('Failed to load command history:', error);
    });

    // ProcessManagerにTerminalManagerの参照を設定
    this.processManager.setTerminalManager(this.terminalManager);

    // バックグラウンドプロセス終了時のコールバックを設定
    this.processManager.setBackgroundProcessCallbacks({
      onComplete: async (executionId: string, executionInfo) => {
        await this.notifyBackgroundProcessComplete(executionId, executionInfo);
      },
      onError: async (executionId: string, executionInfo, error) => {
        await this.notifyBackgroundProcessError(executionId, executionInfo, error);
      },
      onTimeout: async (executionId: string, executionInfo) => {
        await this.notifyBackgroundProcessTimeout(executionId, executionInfo);
      }
    });

    // ツールハンドラーの初期化
    this.shellTools = new ShellTools(
      this.processManager,
      this.terminalManager,
      this.fileManager,
      this.monitoringManager,
      this.securityManager,
      this.commandHistoryManager
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // ツールリストの提供
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        // Shell Operations
        {
          name: 'shell_execute',
          description: 'Execute shell commands securely with intelligent output handling. When output_truncated=true, use output_id with read_execution_output to get complete results. Returns partial output for immediate context while preserving full results in files. Supports adaptive execution mode that automatically switches to background for long-running commands. New: Support pipeline operations with input_output_id to use previous command output as input. NOTE: This is MCP Shell Server tool - do NOT use VS Code internal run_in_terminal parameters like "explanation" or "isBackground".',
          inputSchema: zodToJsonSchema(ShellExecuteParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'process_get_execution',
          description: 'Retrieve detailed information about a specific command execution, including status, output, execution time, and any errors. Use the execution_id returned from shell_execute.',
          inputSchema: zodToJsonSchema(ShellGetExecutionParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'shell_set_default_workdir',
          description: 'Set the default working directory for command execution',
          inputSchema: zodToJsonSchema(ShellSetDefaultWorkdirParamsSchema, { target: 'jsonSchema7' })
        },

        // File Operations
        {
          name: 'list_execution_outputs',
          description: 'List all output files generated by command executions, including stdout, stderr, and log files. Supports filtering by execution ID, output type, or filename pattern.',
          inputSchema: zodToJsonSchema(FileListParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'read_execution_output',
          description: 'Read complete output from command executions when output_truncated=true. Use output_id from shell_execute response to get full stdout/stderr that exceeded size limits or was cut off due to timeouts. Essential for viewing complete results of long commands or large outputs.',
          inputSchema: zodToJsonSchema(FileReadParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'delete_execution_outputs',
          description: 'Delete one or more output files by their output_ids. Requires explicit confirmation flag to prevent accidental deletion. Useful for cleanup after processing results.',
          inputSchema: zodToJsonSchema(FileDeleteParamsSchema, { target: 'jsonSchema7' })
        },
        
        // Issue #15: クリーンアップ機能の追加
        {
          name: 'get_cleanup_suggestions',
          description: 'Get automatic cleanup suggestions for output file management. Analyzes current directory size and file age to recommend cleanup candidates. Helps manage disk usage by identifying old or large files.',
          inputSchema: zodToJsonSchema(CleanupSuggestionsParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'perform_auto_cleanup',  
          description: 'Perform automatic cleanup of old output files based on age and retention policies. Supports dry-run mode for safety. Automatically preserves recent files while cleaning up old ones to manage disk space.',
          inputSchema: zodToJsonSchema(AutoCleanupParamsSchema, { target: 'jsonSchema7' })
        },

        // Terminal Management - Unified Operations
        {
          name: 'terminal_operate',
          description: 'Unified terminal operations: create sessions, send input, get output with automatic position tracking. Combines terminal_create, terminal_send_input, and terminal_get_output into a single streamlined interface for efficient terminal workflows.',
          inputSchema: zodToJsonSchema(TerminalOperateParamsSchema, { target: 'jsonSchema7' })
        },
        
        // Essential terminal operations that remain individual
        {
          name: 'terminal_list',
          description: 'List active terminal sessions',
          inputSchema: zodToJsonSchema(TerminalListParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'terminal_get_info',
          description: 'Get terminal detailed information',
          inputSchema: zodToJsonSchema(TerminalGetParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'terminal_close',
          description: 'Close terminal session',
          inputSchema: zodToJsonSchema(TerminalCloseParamsSchema, { target: 'jsonSchema7' })
        },

        // Command History Operations
        {
          name: 'command_history_query',
          description: 'Universal command history query tool with pagination, search, individual reference, and analytics capabilities. Supports: entry references via execution_id (avoiding duplication with process_get_execution), analytics (stats/patterns/top_commands), paginated search with date filtering. Use this for all command history operations.',
          inputSchema: zodToJsonSchema(CommandHistoryQueryParamsSchema, { target: 'jsonSchema7' })
        }
      ].filter((tool) => !DISABLED_TOOLS.includes(tool.name))
    }));

    // ツール実行ハンドラー
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;
        if (DISABLED_TOOLS.includes(name)) {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Tool ${name} is disabled`
          );
        }

        switch (name) {
          // Shell Operations
          case 'shell_execute': {
            try {
              const params = ShellExecuteParamsSchema.parse(args);
              const result = await this.shellTools.executeShell(params);
              return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            } catch (e) {
              if (e instanceof ZodError) {
                // Check for common VS Code internal tool parameter confusion
                const isExplanationError = args && typeof args === 'object' && 'explanation' in args;
                const isBackgroundError = args && typeof args === 'object' && 'isBackground' in args;
                
                let specificMessage = 'Invalid parameters provided to shell_execute';
                if (isExplanationError || isBackgroundError) {
                  specificMessage = 'IMPORTANT: You are confusing MCP Shell Server with VS Code internal tools. This is "shell_execute" (MCP Shell Server), NOT "run_in_terminal" (VS Code internal). Do NOT use parameters like "explanation" or "isBackground". Use only the parameters defined in shell_execute schema.';
                }
                
                const errorDetails = {
                  error: 'Validation Error',
                  message: specificMessage,
                  receivedArgs: args,
                  validationErrors: e.errors,
                  timestamp: new Date().toISOString(),
                  hint: isExplanationError || isBackgroundError ? 'Use MCP Shell Server parameters only: command, execution_mode, working_directory, etc.' : 'Check the shell_execute schema for valid parameters'
                };
                console.error('[SHELL_EXECUTE_VALIDATION_ERROR]', JSON.stringify(errorDetails, null, 2));
              }
              throw e;
            }
          }

          case 'process_get_execution': {
            const params = ShellGetExecutionParamsSchema.parse(args);
            const result = await this.shellTools.getExecution(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'shell_set_default_workdir': {
            const params = ShellSetDefaultWorkdirParamsSchema.parse(args);
            const result = await this.shellTools.setDefaultWorkingDirectory(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          // Output File Operations  
          case 'list_execution_outputs': {
            const params = FileListParamsSchema.parse(args);
            const result = await this.shellTools.listFiles(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'read_execution_output': {
            const params = FileReadParamsSchema.parse(args);
            const result = await this.shellTools.readFile(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'delete_execution_outputs': {
            const params = FileDeleteParamsSchema.parse(args);
            const result = await this.shellTools.deleteFiles(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          // Issue #15: クリーンアップ機能のハンドラー
          case 'get_cleanup_suggestions': {
            const params = CleanupSuggestionsParamsSchema.parse(args);
            const result = await this.shellTools.getCleanupSuggestions(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'perform_auto_cleanup': {
            const params = AutoCleanupParamsSchema.parse(args);
            const result = await this.shellTools.performAutoCleanup(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          // Terminal Management
          // Terminal Management - Unified Operations
          case 'terminal_operate': {
            const params = TerminalOperateParamsSchema.parse(args);
            const result = await this.shellTools.terminalOperate(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          // Terminal Management - Individual Operations (Legacy, commented out)
          /*
          case 'terminal_create': {
            const params = TerminalCreateParamsSchema.parse(args);
            const result = await this.shellTools.createTerminal(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'terminal_send_input': {
            const params = TerminalInputParamsSchema.parse(args);
            const result = await this.shellTools.sendTerminalInput(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'terminal_get_output': {
            const params = TerminalOutputParamsSchema.parse(args);
            const result = await this.shellTools.getTerminalOutput(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          */

          // Essential terminal operations that remain individual
          case 'terminal_list': {
            const params = TerminalListParamsSchema.parse(args);
            const result = await this.shellTools.listTerminals(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'terminal_get_info': {
            const params = TerminalGetParamsSchema.parse(args);
            const result = await this.shellTools.getTerminal(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'terminal_close': {
            const params = TerminalCloseParamsSchema.parse(args);
            const result = await this.shellTools.closeTerminal(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          // Command History Operations
          case 'command_history_query': {
            const params = CommandHistoryQueryParamsSchema.parse(args);
            const result = await this.shellTools.queryCommandHistory(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof MCPShellError) {
          throw new McpError(ErrorCode.InvalidRequest, error.message);
        }
        throw error;
      }
    });
  }

  // バックグラウンドプロセス終了時の通知メソッド
  private async notifyBackgroundProcessComplete(executionId: string, executionInfo: ExecutionInfo): Promise<void> {
    // コマンドの先頭40文字で識別しやすくする
    const commandPreview = executionInfo.command.length > 40 
      ? `${executionInfo.command.substring(0, 37)}...`
      : executionInfo.command;
    
    // 出力サイズを計算
    const outputSize = (executionInfo.stdout?.length || 0) + (executionInfo.stderr?.length || 0);
    const outputSizeStr = outputSize > 0 ? ` (${outputSize} bytes)` : '';
    
    const message = `✅ Background process completed: ${commandPreview} | Exit: ${executionInfo.exit_code || 0} | Time: ${executionInfo.execution_time_ms}ms${outputSizeStr}`;
    
    logger.info('Background process completed successfully', {
      execution_id: executionId,
      command: executionInfo.command,
      exit_code: executionInfo.exit_code,
      execution_time_ms: executionInfo.execution_time_ms,
      output_size: outputSize
    }, 'background-process');
    
    // MCPクライアントに通知を送信
    try {
      await this.server.notification({
        method: 'notifications/message',
        params: {
          level: 'info',
          data: message
        }
      });
    } catch (error) {
      // 通知送信エラーは内部ログのみ（フォールバックとしてstderr出力）
      console.error(`[INFO] ${message}`);
    }
  }

  private async notifyBackgroundProcessError(executionId: string, executionInfo: ExecutionInfo, error?: Error): Promise<void> {
    const commandPreview = executionInfo.command.length > 40 
      ? `${executionInfo.command.substring(0, 37)}...`
      : executionInfo.command;
    
    const outputSize = (executionInfo.stdout?.length || 0) + (executionInfo.stderr?.length || 0);
    const outputSizeStr = outputSize > 0 ? ` (${outputSize} bytes)` : '';
    
    const message = `❌ Background process failed: ${commandPreview} | Status: ${executionInfo.status} | Time: ${executionInfo.execution_time_ms}ms${outputSizeStr}`;
    
    logger.error('Background process failed', {
      execution_id: executionId,
      command: executionInfo.command,
      status: executionInfo.status,
      execution_time_ms: executionInfo.execution_time_ms,
      error: error?.message,
      output_size: outputSize
    }, 'background-process');
    
    // MCPクライアントに通知を送信
    try {
      await this.server.notification({
        method: 'notifications/message',
        params: {
          level: 'error',
          data: message
        }
      });
    } catch (notificationError) {
      // 通知送信エラーは内部ログのみ（フォールバックとしてstderr出力）
      console.error(`[ERROR] ${message}`);
    }
  }

  private async notifyBackgroundProcessTimeout(executionId: string, executionInfo: ExecutionInfo): Promise<void> {
    const commandPreview = executionInfo.command.length > 40 
      ? `${executionInfo.command.substring(0, 37)}...`
      : executionInfo.command;
    
    const outputSize = (executionInfo.stdout?.length || 0) + (executionInfo.stderr?.length || 0);
    const outputSizeStr = outputSize > 0 ? ` (${outputSize} bytes)` : '';
    
    const message = `⏰ Background process timeout: ${commandPreview} | Time: ${executionInfo.execution_time_ms}ms${outputSizeStr}`;
    
    logger.warn('Background process timed out', {
      execution_id: executionId,
      command: executionInfo.command,
      status: executionInfo.status,
      execution_time_ms: executionInfo.execution_time_ms,
      output_size: outputSize
    }, 'background-process');
    
    // MCPクライアントに通知を送信
    try {
      await this.server.notification({
        method: 'notifications/message',
        params: {
          level: 'warning',
          data: message
        }
      });
    } catch (error) {
      // 通知送信エラーは内部ログのみ（フォールバックとしてstderr出力）
      console.error(`[WARN] ${message}`);
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    // console.error('MCP Shell Server running on stdio');
    logger.info('MCP Shell Server running on stdio', {}, 'server');
    
    // MCPサーバーを実行し続けるために無限に待機
    // MCPクライアントとの接続が切れるまで待機し続ける
    return new Promise<void>((resolve) => {
      // プロセス終了時にresolveする
      process.on('SIGINT', resolve);
      process.on('SIGTERM', resolve);
      
      // transportの終了を監視
      transport.onclose = () => {
        logger.info('Transport closed, shutting down server', {}, 'server');
        resolve();
      };
    });
  }

  async cleanup(): Promise<void> {
    this.processManager.cleanup();
    this.terminalManager.cleanup();
    await this.fileManager.cleanup();
    this.monitoringManager.cleanup();
  }
}

// グレースフルシャットダウン
process.on('SIGINT', async () => {
  // console.error('Received SIGINT, shutting down gracefully...');
  logger.info('Received SIGINT, shutting down gracefully', {}, 'server');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  // console.error('Received SIGTERM, shutting down gracefully...');
  logger.info('Received SIGTERM, shutting down gracefully', {}, 'server');
  process.exit(0);
});
