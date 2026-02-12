import * as fs from 'fs/promises';
import * as net from 'net';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';

import { logger } from '../utils/helpers.js';

const DAEMON_COMPONENT = 'daemon';
const SOCKET_REQUEST_TIMEOUT_MS = 1000;
const HEARTBEAT_TIMEOUT_MS = 500;
const MCP_SOCKET_FILE_NAME = 'mcp.sock';

type DaemonRequest = {
  action?: 'status' | 'info' | 'attach' | 'detach' | 'reattach' | 'stop';
};

type DaemonResponse = {
  ok: boolean;
  error?: string;
  attached?: boolean;
  detached?: boolean;
  attachedAt?: string;
  detachedAt?: string;
  startedAt?: string;
  uptimeSeconds?: number;
  pid?: number;
  cwd?: string;
  branch?: string;
  socketPath?: string;
};

type HeartbeatMessage = {
  type?: 'ping' | 'pong';
};

function getArgValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0 || index === args.length - 1) {
    return undefined;
  }
  return args[index + 1];
}

async function removeIfEmpty(dirPath: string): Promise<void> {
  try {
    const entries = await fs.readdir(dirPath);
    if (entries.length === 0) {
      await fs.rmdir(dirPath);
    }
  } catch {
    // Best-effort cleanup only.
  }
}

async function cleanupSocket(socketPath: string): Promise<void> {
  try {
    await fs.unlink(socketPath);
  } catch {
    return;
  }

  const branchDir = path.dirname(socketPath);
  const hashDir = path.dirname(branchDir);
  await removeIfEmpty(branchDir);
  await removeIfEmpty(hashDir);
}

async function startDaemon(): Promise<void> {
  const args = process.argv.slice(2);
  const socketPath =
    getArgValue(args, '--socket') || process.env['MCP_SHELL_DAEMON_SOCKET'];
  const cwd = getArgValue(args, '--cwd') || process.env['MCP_SHELL_DAEMON_CWD'];
  const branch = getArgValue(args, '--branch') || process.env['MCP_SHELL_DAEMON_BRANCH'];

  if (!socketPath) {
    throw new Error('Daemon socket path is required.');
  }

  if (cwd) {
    process.chdir(cwd);
  }

  const socketDir = path.dirname(socketPath);
  await fs.mkdir(socketDir, { recursive: true });

  try {
    const stat = await fs.stat(socketPath);
    if (stat.isSocket()) {
      await fs.unlink(socketPath);
    }
  } catch {
    // Ignore missing socket.
  }

  const startedAt = new Date().toISOString();
  const state = {
    attached: false,
    detached: false,
    attachedAt: undefined as string | undefined,
    detachedAt: undefined as string | undefined,
  };
  let mcpChild: ChildProcess | null = null;
  const mcpSocketPath = path.join(path.dirname(socketPath), MCP_SOCKET_FILE_NAME);

  const resolveMcpDaemonEntry = (): string => {
    return (
      process.env['MCP_SHELL_MCP_DAEMON_ENTRY']
      || path.resolve(process.cwd(), 'dist/packages/mcp-shell/src/daemon.js')
    );
  };

  const startMcpDaemon = async () => {
    if (mcpChild) {
      return;
    }

    const daemonEntry = resolveMcpDaemonEntry();
    try {
      await fs.access(daemonEntry);
    } catch (error) {
      logger.error('MCP daemon entry not found', { error: String(error), daemonEntry }, DAEMON_COMPONENT);
      return;
    }

    try {
      await fs.unlink(mcpSocketPath);
    } catch {
      // Ignore missing socket.
    }

    mcpChild = spawn(process.execPath, [daemonEntry], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        MCP_SHELL_MCP_SOCKET: mcpSocketPath,
      },
    });
    mcpChild.unref();
  };
  let attachSocket: net.Socket | null = null;
  let pongResolver: ((result: boolean) => void) | null = null;

  const markDetached = () => {
    state.attached = false;
    state.detached = true;
    state.detachedAt = new Date().toISOString();
  };

  const closeAttachSocket = () => {
    if (attachSocket) {
      attachSocket.destroy();
      attachSocket = null;
    }
  };

  const checkAttachLiveness = async (): Promise<boolean> => {
    if (!attachSocket) {
      return false;
    }

    if (pongResolver) {
      return false;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pongResolver = null;
        resolve(false);
      }, HEARTBEAT_TIMEOUT_MS);

      pongResolver = (result: boolean) => {
        clearTimeout(timeout);
        pongResolver = null;
        resolve(result);
      };

      try {
        attachSocket?.write(`${JSON.stringify({ type: 'ping' })}\n`);
      } catch {
        pongResolver = null;
        clearTimeout(timeout);
        resolve(false);
      }
    });
  };

  const sendResponse = (
    socket: net.Socket,
    response: DaemonResponse,
    close: boolean = true
  ) => {
    try {
      socket.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      logger.error('Failed to write daemon response', { error: String(error) }, DAEMON_COMPONENT);
    } finally {
      if (close) {
        socket.end();
      }
    }
  };

  const server = net.createServer((socket) => {
    let buffer = '';
    const timeout = setTimeout(() => {
      socket.destroy();
    }, SOCKET_REQUEST_TIMEOUT_MS);

    socket.setEncoding('utf-8');

    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeAllListeners();
    };

    let handled = false;

    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.includes('\n')) {
        void handleRequest();
      }
    });

    const handleRequest = async () => {
      if (handled) {
        return;
      }
      handled = true;

      cleanup();
      const line = buffer.split('\n')[0]?.trim();
      if (!line) {
        return;
      }

      socket.removeAllListeners('data');
      socket.removeAllListeners('end');

      let request: DaemonRequest;
      try {
        request = JSON.parse(line) as DaemonRequest;
      } catch (error) {
        sendResponse(socket, { ok: false, error: 'invalid_request' });
        return;
      }

      const action = request.action || 'status';
      if (action === 'status' || action === 'info') {
        if (attachSocket) {
          const alive = await checkAttachLiveness();
          if (!alive) {
            closeAttachSocket();
            markDetached();
          }
        }

        const uptimeSeconds = Math.max(0, Math.floor(process.uptime()));
        sendResponse(socket, {
          ok: true,
          attached: state.attached,
          detached: state.detached,
          ...(state.attachedAt ? { attachedAt: state.attachedAt } : {}),
          ...(state.detachedAt ? { detachedAt: state.detachedAt } : {}),
          ...(action === 'info' ? { startedAt } : {}),
          ...(action === 'info' ? { uptimeSeconds } : {}),
          pid: process.pid,
          cwd: process.cwd(),
          ...(branch ? { branch } : {}),
          ...(action === 'info' ? { socketPath } : {}),
          ...(action === 'info' ? { mcpSocketPath } : {}),
        });
        return;
      }

      if (action === 'attach' || action === 'reattach') {
        if (attachSocket) {
          const alive = await checkAttachLiveness();
          if (!alive) {
            closeAttachSocket();
            markDetached();
          }
        }

        if (state.attached && !state.detached) {
          sendResponse(socket, { ok: false, error: 'already_attached' });
          return;
        }

        attachSocket = socket;
        socket.setEncoding('utf-8');
        socket.on('data', (data) => {
          const messages = data.toString().split('\n');
          for (const message of messages) {
            if (!message.trim()) {
              continue;
            }
            let parsed: HeartbeatMessage;
            try {
              parsed = JSON.parse(message) as HeartbeatMessage;
            } catch {
              continue;
            }

            if (parsed.type === 'pong' && pongResolver) {
              pongResolver(true);
            }
          }
        });
        socket.on('close', () => {
          if (attachSocket === socket) {
            attachSocket = null;
          }
          markDetached();
        });
        socket.on('error', () => {
          if (attachSocket === socket) {
            attachSocket = null;
          }
          markDetached();
        });

        state.attached = true;
        state.detached = false;
        state.attachedAt = new Date().toISOString();
        sendResponse(
          socket,
          {
            ok: true,
            attached: state.attached,
            detached: state.detached,
            ...(state.attachedAt ? { attachedAt: state.attachedAt } : {}),
            ...(state.detachedAt ? { detachedAt: state.detachedAt } : {}),
            pid: process.pid,
            cwd: process.cwd(),
            ...(branch ? { branch } : {}),
          },
          false
        );
        return;
      }

      if (action === 'detach') {
        closeAttachSocket();
        markDetached();
        sendResponse(socket, {
          ok: true,
          attached: state.attached,
          detached: state.detached,
          ...(state.attachedAt ? { attachedAt: state.attachedAt } : {}),
          ...(state.detachedAt ? { detachedAt: state.detachedAt } : {}),
          pid: process.pid,
          cwd: process.cwd(),
          ...(branch ? { branch } : {}),
        });
        return;
      }
      if (action === 'stop') {
        sendResponse(socket, { ok: true });
        if (mcpChild?.pid) {
          try {
            process.kill(mcpChild.pid);
          } catch {
            // Best-effort shutdown only.
          }
        }
        await shutdown();
        process.exit(0);
      }

      sendResponse(socket, { ok: false, error: 'unsupported_action' });
    };

    socket.on('end', () => {
      void handleRequest();
    });

    socket.on('error', (error) => {
      cleanup();
      logger.error('Daemon socket error', { error: String(error) }, DAEMON_COMPONENT);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });

  await fs.chmod(socketPath, 0o600);
  await startMcpDaemon();
  logger.info('Daemon socket ready', { socketPath, cwd, branch }, DAEMON_COMPONENT);

  const shutdown = async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await cleanupSocket(socketPath);
  };

  process.on('SIGTERM', () => {
    shutdown().catch((error) => {
      logger.error('Daemon shutdown failed', { error: String(error) }, DAEMON_COMPONENT);
    });
  });
  process.on('SIGINT', () => {
    shutdown().catch((error) => {
      logger.error('Daemon shutdown failed', { error: String(error) }, DAEMON_COMPONENT);
    });
  });
}

startDaemon().catch((error) => {
  logger.error('Daemon startup failed', { error: String(error) }, DAEMON_COMPONENT);
  process.exitCode = 1;
});
