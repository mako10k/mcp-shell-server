#!/usr/bin/env node

import { MCPShellServer } from './server.js';
import { runDaemonProxy } from './daemon-proxy.js';
import { createServerManager, logger } from '../../shell-server/src/runtime/index.js';
import fs from 'fs/promises';

async function getVersion(): Promise<string> {
  // Prefer reading from package.json near dist/index.js
  try {
    const packageJsonUrl = new URL('../package.json', import.meta.url);
    const pkgPath = packageJsonUrl.protocol === 'file:' ? packageJsonUrl : undefined;
    if (pkgPath) {
      const filePath = pkgPath.pathname;
      const json = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(json);
      if (typeof data.version === 'string') return data.version;
    }
  } catch {
    // ignore
  }
  // Fallback to npm-provided env when available
  if (process.env['npm_package_version']) return String(process.env['npm_package_version']);
  return 'unknown';
}

function printHelp(version: string): void {
  const lines = [
    `MCP Shell Server v${version}`,
    '',
    'Usage: mcp-shell-server [options]',
    '',
    'Options:',
    '  -h, --help           Show this help and exit',
    '  -v, --version        Show version and exit',
    '',
    'Environment variables:',
    '  BACKOFFICE_ENABLED=true   Start localhost-only Backoffice UI (default: disabled)',
    '  BACKOFFICE_PORT=3030      Backoffice UI port (listens on 127.0.0.1)',
    '  EXECUTION_BACKEND=local|remote  Select execution backend (default: local)',
    '  EXECUTOR_URL / EXECUTOR_HOST / EXECUTOR_PORT / EXECUTOR_TOKEN  Configure remote executor',
    '  MCP_SHELL_DEFAULT_WORKDIR  Default working directory for shell_execute',
    '  MCP_SHELL_ALLOWED_WORKDIRS  Comma-separated allowed directories',
    '  MCP_DISABLED_TOOLS         Comma-separated tool names to disable',
    '  MCP_SHELL_DAEMON_ENABLED=true  Enable daemon process separation',
    '  MCP_SHELL_USE_DAEMON_MCP=false  Disable MCP daemon proxy (default: enabled when daemon is on)',
    '  LOG_LEVEL=debug|info|warn|error  Log verbosity',
    '',
    'Related commands (from package scripts):',
    '  npm run backoffice:start   Start Backoffice UI only',
    '  npm run executor:start     Start standalone executor backend',
    '',
    'Notes:',
    '  This command runs an MCP server over STDIO. Avoid printing to STDOUT when integrating with MCP clients.',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

async function main() {
  // Lightweight CLI arg parsing (before starting the server)
  const argv = process.argv.slice(2);
  if (argv.includes('--version') || argv.includes('-v')) {
    const ver = await getVersion();
    process.stdout.write(ver + '\n');
    return;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    const ver = await getVersion();
    printHelp(ver);
    return;
  }

  const daemonEnabled = process.env['MCP_SHELL_DAEMON_ENABLED'] === 'true';
  const useDaemonMcp = process.env['MCP_SHELL_USE_DAEMON_MCP'] !== 'false';

  if (daemonEnabled && useDaemonMcp) {
    const serverManager = createServerManager();
    const cwd = process.env['MCP_SHELL_DEFAULT_WORKDIR'] || process.cwd();
    const started = await serverManager.start({ cwd, allowExisting: true });
    const info = await serverManager.get({ serverId: started.serverId });
    const socketPath = info?.mcpSocketPath;
    if (!socketPath) {
      throw new Error('MCP daemon socket was not available.');
    }

    await runDaemonProxy(socketPath);
    return;
  }

  const server = new MCPShellServer();
  
  // グレースフルシャットダウンの設定
  const cleanup = async () => {
    // console.error('Shutting down MCP Shell Server...');
    logger.info('Shutting down MCP Shell Server', {}, 'main');
    await server.cleanup();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('uncaughtException', (error) => {
    // console.error('Uncaught Exception:', error);
    logger.error('Uncaught Exception', { error: error.message, stack: error.stack }, 'main');
    cleanup();
  });
  process.on('unhandledRejection', (reason, promise) => {
    // console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    logger.error('Unhandled Rejection', { reason, promise: promise.toString() }, 'main');
    cleanup();
  });

  try {
    await server.run();
  } catch (error) {
    // console.error('Failed to start MCP Shell Server:', error);
    logger.error('Failed to start MCP Shell Server', { error: String(error) }, 'main');
    process.exit(1);
  }
}

// メイン実行時の判定 - 常に実行（ライブラリとして使用される場合は除く）
main().catch((error) => {
  // console.error('Fatal error:', error);
  logger.error('Fatal error', { error: String(error) }, 'main');
  process.exit(1);
});
