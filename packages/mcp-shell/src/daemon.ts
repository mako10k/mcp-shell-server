import * as fs from 'fs/promises';
import * as net from 'net';
import * as path from 'path';

import { logger, UdsServerTransport } from '../../shell-server/src/runtime/index.js';
import { MCPShellServer } from './server.js';

const DAEMON_COMPONENT = 'mcp-daemon';
const SOCKET_TIMEOUT_MS = 1000;

async function startMcpDaemon(): Promise<void> {
  const socketPath = process.env['MCP_SHELL_MCP_SOCKET'];
  if (!socketPath) {
    throw new Error('MCP socket path is required.');
  }

  await fs.mkdir(path.dirname(socketPath), { recursive: true });

  try {
    const stat = await fs.stat(socketPath);
    if (stat.isSocket()) {
      await fs.unlink(socketPath);
    }
  } catch {
    // Ignore missing socket.
  }

  const server = net.createServer((socket) => {
    const transport = new UdsServerTransport(socket);
    const mcpServer = new MCPShellServer();
    mcpServer.runWithTransport(transport).catch((error) => {
      logger.error('MCP daemon transport failed', { error: String(error) }, DAEMON_COMPONENT);
    });

    socket.setTimeout(SOCKET_TIMEOUT_MS, () => {
      socket.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });

  await fs.chmod(socketPath, 0o600);
  logger.info('MCP daemon socket ready', { socketPath }, DAEMON_COMPONENT);

  const shutdown = async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    try {
      await fs.unlink(socketPath);
    } catch {
      // Ignore cleanup errors.
    }
  };

  process.on('SIGTERM', () => {
    shutdown().catch((error) => {
      logger.error('MCP daemon shutdown failed', { error: String(error) }, DAEMON_COMPONENT);
    });
  });
  process.on('SIGINT', () => {
    shutdown().catch((error) => {
      logger.error('MCP daemon shutdown failed', { error: String(error) }, DAEMON_COMPONENT);
    });
  });
}

startMcpDaemon().catch((error) => {
  logger.error('MCP daemon startup failed', { error: String(error) }, DAEMON_COMPONENT);
  process.exitCode = 1;
});