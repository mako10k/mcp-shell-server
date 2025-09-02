import { BackofficeServer } from './server.js';
import { ProcessManager } from '../core/process-manager.js';
import { TerminalManager } from '../core/terminal-manager.js';
import { FileManager } from '../core/file-manager.js';
import { CommandHistoryManager } from '../core/enhanced-history-manager.js';
import { ConfigManager } from '../core/config-manager.js';
import { logger } from '../utils/helpers.js';

// Minimal bootstrap to run Backoffice standalone for local monitoring
async function main() {
  try {
    const fileManager = new FileManager();
    const configManager = new ConfigManager();
    const enhancedConfig = configManager.getEnhancedSecurityConfig();
    const historyManager = new CommandHistoryManager(enhancedConfig);
    await historyManager.loadHistory().catch((e) => {
      // Non-fatal: start with empty history if load fails
      logger.warn('Backoffice bootstrap: failed to load history', { error: String(e) }, 'backoffice');
    });

    const processManager = new ProcessManager(50, '/tmp/mcp-shell-outputs', fileManager);
    const terminalManager = new TerminalManager();
    processManager.setTerminalManager(terminalManager);

    const backoffice = new BackofficeServer({
      processManager,
      terminalManager,
      fileManager,
      historyManager,
    });

    await backoffice.start();
    logger.info('Backoffice standalone started', {}, 'backoffice');

    const graceful = async () => {
      try {
        await backoffice.stop();
      } finally {
        process.exit(0);
      }
    };
    process.on('SIGINT', graceful);
    process.on('SIGTERM', graceful);
  } catch (e) {
    logger.error('Backoffice standalone failed to start', { error: String(e) }, 'backoffice');
    process.exit(1);
  }
}

void main();
