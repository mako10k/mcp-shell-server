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
import { zodToJsonSchema } from 'zod-to-json-schema';

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
          inputSchema: zodToJsonSchema(ShellExecuteParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'shell_get_execution',
          description: 'Get detailed information about a command execution',
          inputSchema: zodToJsonSchema(ShellGetExecutionParamsSchema, { target: 'jsonSchema7' })
        },

        // Process Management
        {
          name: 'process_list',
          description: 'List running or background processes',
          inputSchema: zodToJsonSchema(ProcessListParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'process_kill',
          description: 'Safely terminate a process',
          inputSchema: zodToJsonSchema(ProcessKillParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'process_monitor',
          description: 'Start real-time monitoring of a process',
          inputSchema: zodToJsonSchema(ProcessMonitorParamsSchema, { target: 'jsonSchema7' })
        },

        // File Operations
        {
          name: 'file_list',
          description: 'List files and output files',
          inputSchema: zodToJsonSchema(FileListParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'file_read',
          description: 'Read file contents',
          inputSchema: zodToJsonSchema(FileReadParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'file_delete',
          description: 'Delete specified files',
          inputSchema: zodToJsonSchema(FileDeleteParamsSchema, { target: 'jsonSchema7' })
        },

        // Terminal Management
        {
          name: 'terminal_create',
          description: 'Create a new interactive terminal session',
          inputSchema: zodToJsonSchema(TerminalCreateParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'terminal_list',
          description: 'List active terminal sessions',
          inputSchema: zodToJsonSchema(TerminalListParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'terminal_get',
          description: 'Get terminal detailed information',
          inputSchema: zodToJsonSchema(TerminalGetParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'terminal_input',
          description: 'Send input to terminal',
          inputSchema: zodToJsonSchema(TerminalInputParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'terminal_output',
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
          description: 'Set execution restrictions',
          inputSchema: zodToJsonSchema(SecuritySetRestrictionsParamsSchema, { target: 'jsonSchema7' })
        },
        {
          name: 'monitoring_get_stats',
          description: 'Get system-wide statistics',
          inputSchema: zodToJsonSchema(MonitoringGetStatsParamsSchema, { target: 'jsonSchema7' })
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
