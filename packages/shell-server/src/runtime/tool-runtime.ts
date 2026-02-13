import { Server } from '@modelcontextprotocol/sdk/server/index.js';

import { ConfigManager } from '../core/config-manager.js';
import { ProcessManager } from '../core/process-manager.js';
import { TerminalManager } from '../core/terminal-manager.js';
import { FileManager } from '../core/file-manager.js';
import { MonitoringManager } from '../core/monitoring-manager.js';
import { StubServerManager, type ServerManager } from '../core/server-manager.js';
import { SecurityManager } from '../security/manager.js';
import type { CreateMessageCallback } from '../security/chat-completion-adapter.js';
import type { ElicitationHandler } from '../security/evaluator-types.js';
import type { EnhancedSecurityConfig } from '../types/enhanced-security.js';
import { CommandHistoryManager } from '../core/enhanced-history-manager.js';
import { ShellTools } from '../tools/shell-tools.js';
import { logger } from '../utils/helpers.js';

export type { CreateMessageCallback } from '../security/chat-completion-adapter.js';
export type { ElicitationHandler } from '../security/evaluator-types.js';

export { BackofficeServer } from '../backoffice/server.js';
export { MCPShellError } from '../utils/errors.js';
export { ExecutionInfo } from '../types/index.js';
export {
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
} from '../types/schemas.js';
export { TerminalOperateParamsSchema } from '../types/quick-schemas.js';
export { logger };

export type ShellToolRuntime = {
  processManager: ProcessManager;
  terminalManager: TerminalManager;
  fileManager: FileManager;
  monitoringManager: MonitoringManager;
  securityManager: SecurityManager;
  commandHistoryManager: CommandHistoryManager;
  shellTools: ShellTools;
  serverManager: ServerManager;
  cleanup: () => Promise<void>;
};

export type ShellToolRuntimeOptions = {
  server?: Server;
  createMessage?: CreateMessageCallback;
  elicitationHandler?: ElicitationHandler;
  enhancedConfigOverrides?: Partial<EnhancedSecurityConfig>;
  outputDir?: string;
  maxConcurrentProcesses?: number;
  defaultWorkingDirectory?: string;
};

export const TOOL_NAMES = [
  'shell_execute',
  'process_get_execution',
  'shell_set_default_workdir',
  'list_execution_outputs',
  'read_execution_output',
  'delete_execution_outputs',
  'get_cleanup_suggestions',
  'perform_auto_cleanup',
  'terminal_operate',
  'terminal_list',
  'terminal_get_info',
  'terminal_close',
  'command_history_query',
  'server_current',
  'server_list_attachable',
  'server_start',
  'server_stop',
  'server_get',
  'server_detach',
  'server_reattach',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
export type ToolParams = Record<string, unknown>;

type DispatchOptions = {
  defaultWorkingDirectory?: string;
  fallbackWorkingDirectory?: string;
};

export function createServerManager(): ServerManager {
  return new StubServerManager();
}

function resolveWorkingDirectory(
  params: ToolParams | undefined,
  options: DispatchOptions
): string {
  const paramRecord = params ?? {};
  const cwdParam = typeof paramRecord['cwd'] === 'string' ? String(paramRecord['cwd']) : undefined;
  return cwdParam || options.defaultWorkingDirectory || options.fallbackWorkingDirectory || process.cwd();
}

export async function dispatchToolCall(
  shellTools: ShellTools,
  serverManager: ServerManager,
  toolName: ToolName,
  params?: ToolParams,
  options: DispatchOptions = {}
): Promise<unknown> {
  const paramRecord = params ?? {};

  switch (toolName) {
    case 'shell_execute':
      return shellTools.executeShellValidated(paramRecord);
    case 'process_get_execution':
      return shellTools.getExecutionValidated(paramRecord);
    case 'shell_set_default_workdir':
      return shellTools.setDefaultWorkingDirectoryValidated(paramRecord);
    case 'list_execution_outputs':
      return shellTools.listFilesValidated(paramRecord);
    case 'read_execution_output':
      return shellTools.readFileValidated(paramRecord);
    case 'delete_execution_outputs':
      return shellTools.deleteFilesValidated(paramRecord);
    case 'get_cleanup_suggestions':
      return shellTools.getCleanupSuggestionsValidated(paramRecord);
    case 'perform_auto_cleanup':
      return shellTools.performAutoCleanupValidated(paramRecord);
    case 'terminal_operate':
      return shellTools.terminalOperateValidated(paramRecord);
    case 'terminal_list':
      return shellTools.listTerminalsValidated(paramRecord);
    case 'terminal_get_info':
      return shellTools.getTerminalValidated(paramRecord);
    case 'terminal_close':
      return shellTools.closeTerminalValidated(paramRecord);
    case 'command_history_query':
      return shellTools.queryCommandHistoryValidated(paramRecord);
    case 'server_current':
      return serverManager.current();
    case 'server_list_attachable': {
      const cwd = resolveWorkingDirectory(params, options);
      return serverManager.listAttachable({ cwd });
    }
    case 'server_start': {
      const cwd = resolveWorkingDirectory(params, options);
      const socketPath =
        typeof paramRecord['socket_path'] === 'string' ? String(paramRecord['socket_path']) : undefined;
      const allowExisting =
        typeof paramRecord['allow_existing'] === 'boolean' ? Boolean(paramRecord['allow_existing']) : false;
      return serverManager.start({
        cwd,
        ...(socketPath ? { socketPath } : {}),
        allowExisting,
      });
    }
    case 'server_stop': {
      const serverId = typeof paramRecord['server_id'] === 'string' ? String(paramRecord['server_id']) : '';
      const force = typeof paramRecord['force'] === 'boolean' ? Boolean(paramRecord['force']) : false;
      await serverManager.stop({ serverId, force });
      return { ok: true };
    }
    case 'server_get': {
      const serverId = typeof paramRecord['server_id'] === 'string' ? String(paramRecord['server_id']) : '';
      return serverManager.get({ serverId });
    }
    case 'server_detach': {
      const serverId = typeof paramRecord['server_id'] === 'string' ? String(paramRecord['server_id']) : '';
      await serverManager.detach({ serverId });
      return { ok: true };
    }
    case 'server_reattach': {
      const serverId = typeof paramRecord['server_id'] === 'string' ? String(paramRecord['server_id']) : '';
      return serverManager.reattach({ serverId });
    }
    default:
      throw new Error(`Unsupported tool: ${toolName}`);
  }
}

export function createShellToolRuntime(options: ShellToolRuntimeOptions = {}): ShellToolRuntime {
  const fileManager = new FileManager();
  const configManager = new ConfigManager();
  const processManager = new ProcessManager(
    options.maxConcurrentProcesses ?? 50,
    options.outputDir ?? '/tmp/mcp-shell-outputs',
    fileManager
  );
  const terminalManager = new TerminalManager();
  const monitoringManager = new MonitoringManager();
  const serverManager = createServerManager();
  const enhancedConfig = configManager.getEnhancedSecurityConfig();
  const commandHistoryManager = new CommandHistoryManager(enhancedConfig);
  const securityManager = new SecurityManager();
  if (options.enhancedConfigOverrides) {
    securityManager.setEnhancedConfig(options.enhancedConfigOverrides);
  }

  if (securityManager.isEnhancedModeEnabled()) {
    securityManager.initializeEnhancedEvaluator(
      commandHistoryManager,
      options.server,
      options.createMessage,
      options.elicitationHandler
    );
  }

  commandHistoryManager.loadHistory().catch((error) => {
    logger.warn('Failed to load command history', { error: String(error) }, 'runtime');
  });

  if (options.defaultWorkingDirectory) {
    try {
      processManager.setDefaultWorkingDirectory(options.defaultWorkingDirectory);
    } catch (error) {
      logger.warn(
        'Failed to set default working directory',
        { error: String(error), workingDirectory: options.defaultWorkingDirectory },
        'runtime'
      );
    }
  }

  processManager.setTerminalManager(terminalManager);

  const shellTools = new ShellTools(
    processManager,
    terminalManager,
    fileManager,
    monitoringManager,
    securityManager,
    commandHistoryManager
  );

  const cleanup = async () => {
    processManager.cleanup();
    terminalManager.cleanup();
    await fileManager.cleanup();
    monitoringManager.cleanup();
  };

  return {
    processManager,
    terminalManager,
    fileManager,
    monitoringManager,
    securityManager,
    commandHistoryManager,
    shellTools,
    serverManager,
    cleanup
  };
}
