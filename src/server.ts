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

import { MCPShellError } from './utils/errors.js';

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

    // マネージャーの初期化
    this.processManager = new ProcessManager();
    this.terminalManager = new TerminalManager();
    this.fileManager = new FileManager();
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
          description: 'Execute shell commands securely in a sandboxed environment. Can also create new interactive terminal sessions.',
          inputSchema: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'Command to execute' },
              execution_mode: { 
                type: 'string', 
                enum: ['sync', 'async', 'background'],
                default: 'sync',
                description: 'Execution mode'
              },
              working_directory: { type: 'string', description: 'Working directory' },
              environment_variables: { 
                type: 'object',
                additionalProperties: { type: 'string' },
                description: 'Environment variables'
              },
              input_data: { type: 'string', description: 'Standard input data' },
              timeout_seconds: { 
                type: 'number',
                minimum: 1,
                maximum: 3600,
                default: 30,
                description: 'Timeout in seconds'
              },
              max_output_size: {
                type: 'number',
                minimum: 1024,
                maximum: 104857600,
                default: 1048576,
                description: 'Maximum output size in bytes'
              },
              capture_stderr: {
                type: 'boolean',
                default: true,
                description: 'Capture standard error output'
              },
              session_id: { type: 'string', description: 'Session ID for session management' },
              create_terminal: {
                type: 'boolean',
                default: false,
                description: 'Create a new interactive terminal session instead of running command directly'
              },
              terminal_shell: {
                type: 'string',
                enum: ['bash', 'zsh', 'fish', 'sh', 'powershell'],
                description: 'Shell type for the new terminal (only used when create_terminal is true)'
              },
              terminal_dimensions: {
                type: 'object',
                properties: {
                  width: { type: 'number', minimum: 10, maximum: 500 },
                  height: { type: 'number', minimum: 5, maximum: 200 }
                },
                description: 'Terminal dimensions (only used when create_terminal is true)'
              }
            },
            required: ['command']
          }
        },
        {
          name: 'shell_get_execution',
          description: 'Get detailed information about a command execution',
          inputSchema: {
            type: 'object',
            properties: {
              execution_id: { type: 'string', description: 'Execution ID' }
            },
            required: ['execution_id']
          }
        },

        // Process Management
        {
          name: 'process_list',
          description: 'List running or background processes',
          inputSchema: {
            type: 'object',
            properties: {
              status_filter: {
                type: 'string',
                enum: ['running', 'completed', 'failed', 'all'],
                description: 'Filter by process status'
              },
              command_pattern: { type: 'string', description: 'Filter by command pattern' },
              session_id: { type: 'string', description: 'Filter by session ID' },
              limit: {
                type: 'number',
                minimum: 1,
                maximum: 500,
                default: 50,
                description: 'Maximum number of results'
              },
              offset: {
                type: 'number',
                minimum: 0,
                default: 0,
                description: 'Offset for pagination'
              }
            },
            required: []
          }
        },
        {
          name: 'process_kill',
          description: 'Safely terminate a process',
          inputSchema: {
            type: 'object',
            properties: {
              process_id: { type: 'number', description: 'Process ID' },
              signal: {
                type: 'string',
                enum: ['TERM', 'KILL', 'INT', 'HUP', 'USR1', 'USR2'],
                default: 'TERM',
                description: 'Signal to send'
              },
              force: {
                type: 'boolean',
                default: false,
                description: 'Force termination flag'
              }
            },
            required: ['process_id']
          }
        },
        {
          name: 'process_monitor',
          description: 'Start real-time monitoring of a process',
          inputSchema: {
            type: 'object',
            properties: {
              process_id: { type: 'number', description: 'Process ID' },
              monitor_interval_ms: {
                type: 'number',
                minimum: 100,
                maximum: 60000,
                default: 1000,
                description: 'Monitoring interval in milliseconds'
              },
              include_metrics: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['cpu', 'memory', 'io', 'network']
                },
                description: 'Metrics to monitor'
              }
            },
            required: ['process_id']
          }
        },

        // File Operations
        {
          name: 'file_list',
          description: 'List files and output files',
          inputSchema: {
            type: 'object',
            properties: {
              file_type: {
                type: 'string',
                enum: ['output', 'log', 'temp', 'all'],
                description: 'Filter by file type'
              },
              execution_id: { type: 'string', description: 'Filter by execution ID' },
              name_pattern: { type: 'string', description: 'Filter by filename pattern' },
              limit: {
                type: 'number',
                minimum: 1,
                maximum: 1000,
                default: 100,
                description: 'Maximum number of results'
              }
            },
            required: []
          }
        },
        {
          name: 'file_read',
          description: 'Read file contents',
          inputSchema: {
            type: 'object',
            properties: {
              file_id: { type: 'string', description: 'File ID' },
              offset: {
                type: 'number',
                minimum: 0,
                default: 0,
                description: 'Read offset'
              },
              size: {
                type: 'number',
                minimum: 1,
                maximum: 10485760,
                default: 8192,
                description: 'Read size'
              },
              encoding: {
                type: 'string',
                default: 'utf-8',
                description: 'Character encoding'
              }
            },
            required: ['file_id']
          }
        },
        {
          name: 'file_delete',
          description: 'Delete specified files',
          inputSchema: {
            type: 'object',
            properties: {
              file_ids: {
                type: 'array',
                items: { type: 'string' },
                minItems: 1,
                description: 'List of file IDs to delete'
              },
              confirm: {
                type: 'boolean',
                description: 'Deletion confirmation flag'
              }
            },
            required: ['file_ids', 'confirm']
          }
        },

        // Terminal Management
        {
          name: 'terminal_create',
          description: 'Create a new interactive terminal session',
          inputSchema: {
            type: 'object',
            properties: {
              session_name: { type: 'string', description: 'Session name' },
              shell_type: {
                type: 'string',
                enum: ['bash', 'zsh', 'fish', 'cmd', 'powershell'],
                default: 'bash',
                description: 'Shell type'
              },
              dimensions: {
                type: 'object',
                properties: {
                  width: {
                    type: 'number',
                    minimum: 1,
                    maximum: 500,
                    default: 120,
                    description: 'Terminal width in characters'
                  },
                  height: {
                    type: 'number',
                    minimum: 1,
                    maximum: 200,
                    default: 30,
                    description: 'Terminal height in lines'
                  }
                },
                description: 'Terminal dimensions'
              },
              working_directory: { type: 'string', description: 'Initial working directory' },
              environment_variables: {
                type: 'object',
                additionalProperties: { type: 'string' },
                description: 'Environment variables'
              },
              auto_save_history: {
                type: 'boolean',
                default: true,
                description: 'Auto-save command history'
              }
            },
            required: []
          }
        },
        {
          name: 'terminal_list',
          description: 'List active terminal sessions',
          inputSchema: {
            type: 'object',
            properties: {
              session_name_pattern: { type: 'string', description: 'Session name pattern' },
              status_filter: {
                type: 'string',
                enum: ['active', 'idle', 'all'],
                description: 'Filter by status'
              },
              limit: {
                type: 'number',
                minimum: 1,
                maximum: 200,
                default: 50,
                description: 'Maximum number of results'
              }
            },
            required: []
          }
        },
        {
          name: 'terminal_get',
          description: 'Get terminal detailed information',
          inputSchema: {
            type: 'object',
            properties: {
              terminal_id: { type: 'string', description: 'Terminal ID' }
            },
            required: ['terminal_id']
          }
        },
        {
          name: 'terminal_input',
          description: 'Send input to terminal',
          inputSchema: {
            type: 'object',
            properties: {
              terminal_id: { type: 'string', description: 'Terminal ID' },
              input: { type: 'string', description: 'Input content' },
              execute: {
                type: 'boolean',
                default: false,
                description: 'Auto-execute flag (send Enter key)'
              }
            },
            required: ['terminal_id', 'input']
          }
        },
        {
          name: 'terminal_output',
          description: 'Get terminal output',
          inputSchema: {
            type: 'object',
            properties: {
              terminal_id: { type: 'string', description: 'Terminal ID' },
              start_line: {
                type: 'number',
                minimum: 0,
                default: 0,
                description: 'Start line number'
              },
              line_count: {
                type: 'number',
                minimum: 1,
                maximum: 10000,
                default: 100,
                description: 'Number of lines to get'
              },
              include_ansi: {
                type: 'boolean',
                default: false,
                description: 'Include ANSI control codes'
              }
            },
            required: ['terminal_id']
          }
        },
        {
          name: 'terminal_resize',
          description: 'Resize terminal',
          inputSchema: {
            type: 'object',
            properties: {
              terminal_id: { type: 'string', description: 'Terminal ID' },
              dimensions: {
                type: 'object',
                properties: {
                  width: { type: 'number', minimum: 1, maximum: 500, description: 'New width' },
                  height: { type: 'number', minimum: 1, maximum: 200, description: 'New height' }
                },
                required: ['width', 'height'],
                description: 'New dimensions'
              }
            },
            required: ['terminal_id', 'dimensions']
          }
        },
        {
          name: 'terminal_close',
          description: 'Close terminal session',
          inputSchema: {
            type: 'object',
            properties: {
              terminal_id: { type: 'string', description: 'Terminal ID' },
              save_history: {
                type: 'boolean',
                default: true,
                description: 'Save command history'
              }
            },
            required: ['terminal_id']
          }
        },

        // Security & Monitoring
        {
          name: 'security_set_restrictions',
          description: 'Set execution restrictions',
          inputSchema: {
            type: 'object',
            properties: {
              allowed_commands: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of allowed commands'
              },
              blocked_commands: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of blocked commands'
              },
              allowed_directories: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of allowed directories'
              },
              max_execution_time: {
                type: 'number',
                minimum: 1,
                maximum: 86400,
                description: 'Maximum execution time in seconds'
              },
              max_memory_mb: {
                type: 'number',
                minimum: 1,
                maximum: 32768,
                description: 'Maximum memory usage in MB'
              },
              enable_network: {
                type: 'boolean',
                default: true,
                description: 'Enable network access'
              }
            },
            required: []
          }
        },
        {
          name: 'monitoring_get_stats',
          description: 'Get system-wide statistics',
          inputSchema: {
            type: 'object',
            properties: {
              include_metrics: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['processes', 'terminals', 'files', 'system']
                },
                description: 'Metrics to include'
              },
              time_range_minutes: {
                type: 'number',
                minimum: 1,
                maximum: 1440,
                default: 60,
                description: 'Time range in minutes'
              }
            },
            required: []
          }
        }
      ]
    }));

    // ツール実行ハンドラー
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;

        switch (name) {
          // Shell Operations
          case 'shell_execute': {
            const params = ShellExecuteParamsSchema.parse(args);
            const result = await this.shellTools.executeShell(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'shell_get_execution': {
            const params = ShellGetExecutionParamsSchema.parse(args);
            const result = await this.shellTools.getExecution(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          // Process Management
          case 'process_list': {
            const params = ProcessListParamsSchema.parse(args);
            const result = await this.shellTools.listProcesses(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'process_kill': {
            const params = ProcessKillParamsSchema.parse(args);
            const result = await this.shellTools.killProcess(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'process_monitor': {
            const params = ProcessMonitorParamsSchema.parse(args);
            const result = await this.shellTools.monitorProcess(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          // File Operations  
          case 'file_list': {
            const params = FileListParamsSchema.parse(args);
            const result = await this.shellTools.listFiles(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'file_read': {
            const params = FileReadParamsSchema.parse(args);
            const result = await this.shellTools.readFile(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'file_delete': {
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

          case 'terminal_get': {
            const params = TerminalGetParamsSchema.parse(args);
            const result = await this.shellTools.getTerminal(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'terminal_input': {
            const params = TerminalInputParamsSchema.parse(args);
            const result = await this.shellTools.sendTerminalInput(params);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'terminal_output': {
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
