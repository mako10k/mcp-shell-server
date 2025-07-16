import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { ProcessManager } from './core/process-manager.js';
import { TerminalManager } from './core/terminal-manager.js';
import { FileManager } from './core/file-manager.js';
import { MonitoringManager } from './core/monitoring-manager.js';
import { SecurityManager } from './security/manager.js';
import { ShellTools } from './tools/shell-tools.js';
import { logger } from './utils/helpers.js';

import {
  ShellExecuteParamsSchema,
  ShellGetExecutionParamsSchema,
  ShellSetDefaultWorkdirParamsSchema,
  ProcessListParamsSchema,
  ProcessKillParamsSchema,
  ProcessMonitorParamsSchema,
  FileListParamsSchema,
  FileReadParamsSchema,
  FileDeleteParamsSchema,
  TerminalCreateParamsSchema,
  TerminalListParamsSchema,
  TerminalGetParamsSchema,
  TerminalInputParamsSchema,
  TerminalOutputParamsSchema,
  TerminalResizeParamsSchema,
  TerminalCloseParamsSchema,
  SecuritySetRestrictionsParamsSchema,
  MonitoringGetStatsParamsSchema,
} from './types/schemas.js';
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
        },
      }
    );

    // マネージャーの初期化（FileManagerを最初に初期化）
    this.fileManager = new FileManager();
    this.processManager = new ProcessManager(50, '/tmp/mcp-shell-outputs', this.fileManager);
    this.terminalManager = new TerminalManager();
    this.monitoringManager = new MonitoringManager();
    this.securityManager = new SecurityManager();

    // ProcessManagerにTerminalManagerの参照を設定
    this.processManager.setTerminalManager(this.terminalManager);

    // ツールハンドラーの初期化
    this.shellTools = new ShellTools(
      this.processManager,
      this.terminalManager,
      this.fileManager,
      this.monitoringManager,
      this.securityManager
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
          description: 'Execute shell commands securely with intelligent output handling. When output_truncated=true, use output_id with read_execution_output to get complete results. Returns partial output for immediate context while preserving full results in files. Supports adaptive execution mode that automatically switches to background for long-running commands.',
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

        // Process Management
        {
          name: 'process_list',
          description: 'List all active, completed, or failed processes with their status, command, execution time, and resource usage. Supports filtering by status, command pattern, or session.',
          inputSchema: zodToJsonSchema(ProcessListParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'process_terminate',
          description: 'Safely terminate a running process by sending a signal (TERM, KILL, INT, etc.). Use force flag for immediate termination. Requires valid process_id from process_list.',
          inputSchema: zodToJsonSchema(ProcessKillParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'process_monitor',
          description: 'Start real-time monitoring of a running process to track CPU, memory, I/O, and network usage. Returns periodic statistics until the process terminates.',
          inputSchema: zodToJsonSchema(ProcessMonitorParamsSchema, { target: 'jsonSchema7' })
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

        // Terminal Management
        {
          name: 'terminal_create',
          description: 'Create a new interactive terminal session with persistent state. Supports different shell types (bash, zsh, fish), custom dimensions, and environment variables. Use for interactive workflows.',
          inputSchema: zodToJsonSchema(TerminalCreateParamsSchema, { target: 'jsonSchema7' })
        },
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
          name: 'terminal_send_input',
          description: 'Send input to terminal',
          inputSchema: zodToJsonSchema(TerminalInputParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'terminal_get_output',
          description: 'Get terminal output',
          inputSchema: zodToJsonSchema(TerminalOutputParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'terminal_resize',
          description: 'Resize terminal',
          inputSchema: zodToJsonSchema(TerminalResizeParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'terminal_close',
          description: 'Close terminal session',
          inputSchema: zodToJsonSchema(TerminalCloseParamsSchema, { target: 'jsonSchema7' })
        },

        // Security & Monitoring
        {
          name: 'security_set_restrictions',
          description: 'Configure security restrictions for command execution using predefined modes (permissive, restrictive) or custom rules. Controls allowed commands, directories, and resource limits.',
          inputSchema: zodToJsonSchema(SecuritySetRestrictionsParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'monitoring_get_stats',
          description: 'Retrieve system-wide statistics including process counts, terminal usage, file operations, and system resources over a specified time range.',
          inputSchema: zodToJsonSchema(MonitoringGetStatsParamsSchema, { target: 'jsonSchema7' })
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
            const params = ShellExecuteParamsSchema.parse(args);
            const result = await this.shellTools.executeShell(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
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

          // Process Management
          case 'process_list': {
            const params = ProcessListParamsSchema.parse(args);
            const result = await this.shellTools.listProcesses(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'process_terminate': {
            const params = ProcessKillParamsSchema.parse(args);
            const result = await this.shellTools.killProcess(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'process_monitor': {
            const params = ProcessMonitorParamsSchema.parse(args);
            const result = await this.shellTools.monitorProcess(params);
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

          // Terminal Management
          case 'terminal_create': {
            const params = TerminalCreateParamsSchema.parse(args);
            const result = await this.shellTools.createTerminal(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

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

          case 'terminal_resize': {
            const params = TerminalResizeParamsSchema.parse(args);
            const result = await this.shellTools.resizeTerminal(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'terminal_close': {
            const params = TerminalCloseParamsSchema.parse(args);
            const result = await this.shellTools.closeTerminal(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          // Security & Monitoring
          case 'security_set_restrictions': {
            const params = SecuritySetRestrictionsParamsSchema.parse(args);
            const result = await this.shellTools.setSecurityRestrictions(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'monitoring_get_stats': {
            const params = MonitoringGetStatsParamsSchema.parse(args);
            const result = await this.shellTools.getMonitoringStats(params);
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
