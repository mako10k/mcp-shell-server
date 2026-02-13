import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod';

import {
  createShellToolRuntime,
  dispatchToolCall,
  BackofficeServer,
  MCPShellError,
  ExecutionInfo,
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
  ServerCurrentParamsSchema,
  ServerListAttachableParamsSchema,
  ServerStartParamsSchema,
  ServerStopParamsSchema,
  ServerGetParamsSchema,
  ServerDetachParamsSchema,
  ServerReattachParamsSchema,
  TerminalOperateParamsSchema,
  logger,
  type ShellToolRuntime,
  type ToolName,
  type ToolParams,
} from '../../shell-server/src/runtime/index.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Tools can be disabled by specifying a comma-separated list in the
// MCP_DISABLED_TOOLS environment variable. Disabled tools will not be
// advertised or executable.
const DISABLED_TOOLS: string[] = (process.env['MCP_DISABLED_TOOLS'] || '')
  .split(',')
  .map((t) => t.trim())
  .filter((t) => t.length > 0);

export class MCPShellServer {
  private server: Server;
  private processManager: ShellToolRuntime['processManager'];
  private terminalManager: ShellToolRuntime['terminalManager'];
  private fileManager: ShellToolRuntime['fileManager'];
  private monitoringManager: ShellToolRuntime['monitoringManager'];
  private commandHistoryManager: ShellToolRuntime['commandHistoryManager'];
  private shellTools: ShellToolRuntime['shellTools'];
  private serverManager: ShellToolRuntime['serverManager'];
  private backoffice?: BackofficeServer;

  constructor() {
    this.server = new Server(
      {
        name: 'mcp-shell-server',
        version: '2.0.0',
      },
      {
        capabilities: {
          tools: {},
          logging: {}, // Enable log notification functionality
          sampling: {}, // Enable Function Calling and LLM integration capabilities
        },
      }
    );

    const runtime = createShellToolRuntime({ server: this.server });
    this.fileManager = runtime.fileManager;
    this.processManager = runtime.processManager;
    this.terminalManager = runtime.terminalManager;
    this.monitoringManager = runtime.monitoringManager;
    this.commandHistoryManager = runtime.commandHistoryManager;
    this.shellTools = runtime.shellTools;
    this.serverManager = runtime.serverManager;
    void this.serverManager;

    // バックグラウンドプロセス終了時のコールバックを設定
    this.processManager.setBackgroundProcessCallbacks({
      onComplete: async (executionId: string, executionInfo) => {
        await this.notifyBackgroundProcessComplete(executionId, executionInfo);
      },
      onError: async (executionId: string, executionInfo, error) => {
        await this.notifyBackgroundProcessError(executionId, executionInfo, error instanceof Error ? error : new Error(String(error)));
      },
      onTimeout: async (executionId: string, executionInfo) => {
        await this.notifyBackgroundProcessTimeout(executionId, executionInfo);
      }
    });

    this.setupHandlers();

    // Optional Backoffice server
    if (process.env['BACKOFFICE_ENABLED'] === 'true') {
      this.backoffice = new BackofficeServer({
        processManager: this.processManager,
        terminalManager: this.terminalManager,
        fileManager: this.fileManager,
        historyManager: this.commandHistoryManager,
      });
      this.backoffice
        .start()
        .catch((e) => logger.error('Failed to start Backoffice', { error: String(e) }, 'backoffice'));
    }
  }

  private setupHandlers(): void {
    const parseServerParams = (
      name: string,
      args: ToolParams | undefined,
      dispatchOptions: { defaultWorkingDirectory?: string; fallbackWorkingDirectory: string }
    ): ToolParams | null => {
      switch (name) {
        case 'server_current':
          return ServerCurrentParamsSchema.parse(args ?? {});
        case 'server_list_attachable': {
          const cwd =
            (args && typeof args === 'object' && 'cwd' in args
              ? String((args as { cwd?: string }).cwd || '')
              : '') || dispatchOptions.defaultWorkingDirectory || dispatchOptions.fallbackWorkingDirectory;
          return ServerListAttachableParamsSchema.parse({ cwd });
        }
        case 'server_start':
          return ServerStartParamsSchema.parse(args);
        case 'server_stop':
          return ServerStopParamsSchema.parse(args);
        case 'server_get':
          return ServerGetParamsSchema.parse(args);
        case 'server_detach':
          return ServerDetachParamsSchema.parse(args);
        case 'server_reattach':
          return ServerReattachParamsSchema.parse(args);
        default:
          return null;
      }
    };

    const parseNonServerParams = (name: string, args: ToolParams | undefined): ToolParams | null => {
      switch (name) {
        case 'process_get_execution':
          return ShellGetExecutionParamsSchema.parse(args);
        case 'shell_set_default_workdir':
          return ShellSetDefaultWorkdirParamsSchema.parse(args);
        case 'list_execution_outputs':
          return FileListParamsSchema.parse(args);
        case 'read_execution_output':
          return FileReadParamsSchema.parse(args);
        case 'delete_execution_outputs':
          return FileDeleteParamsSchema.parse(args);
        case 'get_cleanup_suggestions':
          return CleanupSuggestionsParamsSchema.parse(args);
        case 'perform_auto_cleanup':
          return AutoCleanupParamsSchema.parse(args);
        case 'terminal_operate':
          return TerminalOperateParamsSchema.parse(args);
        case 'terminal_list':
          return TerminalListParamsSchema.parse(args);
        case 'terminal_get_info':
          return TerminalGetParamsSchema.parse(args);
        case 'terminal_close':
          return TerminalCloseParamsSchema.parse(args);
        case 'command_history_query':
          return CommandHistoryQueryParamsSchema.parse(args);
        default:
          return null;
      }
    };
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
        },

        // Server Management
        {
          name: 'server_current',
          description: 'Get current server information, including attach status and socket path when available.',
          inputSchema: zodToJsonSchema(ServerCurrentParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'server_list_attachable',
          description: 'List attachable servers for a given working directory boundary.',
          inputSchema: zodToJsonSchema(ServerListAttachableParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'server_start',
          description: 'Start or discover a server for the specified working directory.',
          inputSchema: zodToJsonSchema(ServerStartParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'server_stop',
          description: 'Stop a running server by server_id.',
          inputSchema: zodToJsonSchema(ServerStopParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'server_get',
          description: 'Get server metadata by server_id.',
          inputSchema: zodToJsonSchema(ServerGetParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'server_detach',
          description: 'Detach from a server without stopping it.',
          inputSchema: zodToJsonSchema(ServerDetachParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'server_reattach',
          description: 'Attach to a detached server by server_id.',
          inputSchema: zodToJsonSchema(ServerReattachParamsSchema, { target: 'jsonSchema7' })
        },

        // Dynamic Security Criteria Adjustment
        // NOTE: MCP-side adjust_criteria tool is disabled (security concern - evaluated party should not adjust evaluation criteria)
        // Use Validator-side adjustValidatorCriteria instead for internal criteria adjustment
        /*
        {
          name: 'adjust_criteria',
          description: 'Adjust security evaluation criteria dynamically to better align with user workflow patterns. Allows modifying, appending, or overwriting criteria text with automatic backup functionality.',
          inputSchema: zodToJsonSchema(AdjustCriteriaParamsSchema, { target: 'jsonSchema7' })
        }
        */
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

        const dispatchOptions = {
          ...(process.env['MCP_SHELL_DEFAULT_WORKDIR']
            ? { defaultWorkingDirectory: process.env['MCP_SHELL_DEFAULT_WORKDIR'] }
            : {}),
          fallbackWorkingDirectory: process.cwd(),
        };

        if (name === 'shell_execute') {
          try {
            const parsed = ShellExecuteParamsSchema.parse(args);
            const result = await dispatchToolCall(
              this.shellTools,
              this.serverManager,
              name as ToolName,
              parsed as ToolParams,
              dispatchOptions
            );
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
                hint: isExplanationError || isBackgroundError
                  ? 'Use MCP Shell Server parameters only: command, execution_mode, working_directory, etc.'
                  : 'Check the shell_execute schema for valid parameters'
              };
              console.error('[SHELL_EXECUTE_VALIDATION_ERROR]', JSON.stringify(errorDetails, null, 2));
            }
            throw e;
          }
        }

        const parsedServerParams = parseServerParams(name, args as ToolParams, dispatchOptions);
        if (parsedServerParams) {
          const result = await dispatchToolCall(
            this.shellTools,
            this.serverManager,
            name as ToolName,
            parsedServerParams as ToolParams,
            dispatchOptions
          );
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        const parsedNonServerParams = parseNonServerParams(name, args as ToolParams);
        if (parsedNonServerParams) {
          const result = await dispatchToolCall(
            this.shellTools,
            this.serverManager,
            name as ToolName,
            parsedNonServerParams as ToolParams,
            dispatchOptions
          );
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        try {
          const result = await dispatchToolCall(
            this.shellTools,
            this.serverManager,
            name as ToolName,
            args as ToolParams,
            dispatchOptions
          );
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('Unsupported tool:')) {
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
          }
          throw error;
        }
      } catch (error) {
        if (error instanceof MCPShellError) {
          throw new McpError(ErrorCode.InvalidRequest, error.message);
        }
        throw error;
      }
    });
  }

  // バックグラウンドプロセス通知用の共通ヘルパー
  private getProcessNotificationInfo(executionInfo: ExecutionInfo): { commandPreview: string; outputSizeStr: string } {
    const commandPreview = executionInfo.command.length > 40 
      ? `${executionInfo.command.substring(0, 37)}...`
      : executionInfo.command;
    
    const outputSize = (executionInfo.stdout?.length || 0) + (executionInfo.stderr?.length || 0);
    const outputSizeStr = outputSize > 0 ? ` (${outputSize} bytes)` : '';
    
    return { commandPreview, outputSizeStr };
  }

  private async notifyClient(level: 'info' | 'error' | 'warning', message: string): Promise<void> {
    try {
      await this.server.notification({
        method: 'notifications/message',
        params: {
          level,
          data: message
        }
      });
    } catch (error) {
      const prefix = level === 'warning' ? 'WARN' : level.toUpperCase();
      console.error(`[${prefix}] ${message}`);
    }
  }

  // バックグラウンドプロセス終了時の通知メソッド
  private async notifyBackgroundProcessComplete(executionId: string, executionInfo: ExecutionInfo): Promise<void> {
    const { commandPreview, outputSizeStr } = this.getProcessNotificationInfo(executionInfo);
    
    const message = `✅ Background process completed: ${commandPreview} | Exit: ${executionInfo.exit_code || 0} | Time: ${executionInfo.execution_time_ms}ms${outputSizeStr}`;
    
    logger.info('Background process completed successfully', {
      execution_id: executionId,
      command: executionInfo.command,
      exit_code: executionInfo.exit_code,
      execution_time_ms: executionInfo.execution_time_ms,
      output_size: (executionInfo.stdout?.length || 0) + (executionInfo.stderr?.length || 0)
    }, 'background-process');
    
    // MCPクライアントに通知を送信
    await this.notifyClient('info', message);
  }

  private async notifyBackgroundProcessError(executionId: string, executionInfo: ExecutionInfo, error?: Error): Promise<void> {
    const { commandPreview, outputSizeStr } = this.getProcessNotificationInfo(executionInfo);
    
    const message = `❌ Background process failed: ${commandPreview} | Status: ${executionInfo.status} | Time: ${executionInfo.execution_time_ms}ms${outputSizeStr}`;
    
    logger.error('Background process failed', {
      execution_id: executionId,
      command: executionInfo.command,
      status: executionInfo.status,
      execution_time_ms: executionInfo.execution_time_ms,
      error: error?.message,
      output_size: (executionInfo.stdout?.length || 0) + (executionInfo.stderr?.length || 0)
    }, 'background-process');
    
    // MCPクライアントに通知を送信
    await this.notifyClient('error', message);
  }

  private async notifyBackgroundProcessTimeout(executionId: string, executionInfo: ExecutionInfo): Promise<void> {
    const { commandPreview, outputSizeStr } = this.getProcessNotificationInfo(executionInfo);
    
    const message = `⏰ Background process timeout: ${commandPreview} | Time: ${executionInfo.execution_time_ms}ms${outputSizeStr}`;
    
    logger.warn('Background process timed out', {
      execution_id: executionId,
      command: executionInfo.command,
      status: executionInfo.status,
      execution_time_ms: executionInfo.execution_time_ms,
      output_size: (executionInfo.stdout?.length || 0) + (executionInfo.stderr?.length || 0)
    }, 'background-process');
    
    // MCPクライアントに通知を送信
    await this.notifyClient('warning', message);
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.runWithTransport(transport);
  }

  async runWithTransport(transport: Transport): Promise<void> {
    await this.server.connect(transport);
    logger.info('MCP Shell Server running', {}, 'server');
    
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
    if (this.backoffice) {
      try {
        await this.backoffice.stop();
      } catch (e) {
        logger.warn('Backoffice stop failed', { error: String(e) }, 'backoffice');
      }
    }
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
