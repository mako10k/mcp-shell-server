import { Server } from '@modelcontextprotocol/sdk/server/index.js';

import { ConfigManager } from '../core/config-manager.js';
import { ProcessManager } from '../core/process-manager.js';
import { TerminalManager } from '../core/terminal-manager.js';
import { FileManager } from '../core/file-manager.js';
import { MonitoringManager } from '../core/monitoring-manager.js';
import { SecurityManager } from '../security/manager.js';
import type { CreateMessageCallback } from '../security/chat-completion-adapter.js';
import type { ElicitationHandler } from '../security/evaluator-types.js';
import type { EnhancedSecurityConfig } from '../types/enhanced-security.js';
import { CommandHistoryManager } from '../core/enhanced-history-manager.js';
import { ShellTools } from '../tools/shell-tools.js';
import { logger } from '../utils/helpers.js';

export type { CreateMessageCallback } from '../security/chat-completion-adapter.js';
export type { ElicitationHandler } from '../security/evaluator-types.js';

export type ShellToolRuntime = {
  processManager: ProcessManager;
  terminalManager: TerminalManager;
  fileManager: FileManager;
  monitoringManager: MonitoringManager;
  securityManager: SecurityManager;
  commandHistoryManager: CommandHistoryManager;
  shellTools: ShellTools;
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
    cleanup
  };
}
