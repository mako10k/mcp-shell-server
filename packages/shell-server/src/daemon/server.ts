import * as fs from 'fs/promises';
import * as net from 'net';
import * as path from 'path';

import { logger } from '../utils/helpers.js';

const DAEMON_COMPONENT = 'daemon';
const SOCKET_REQUEST_TIMEOUT_MS = 1000;

type DaemonRequest = {
  action?: 'status' | 'attach' | 'detach' | 'reattach';
};

type DaemonResponse = {
  ok: boolean;
  error?: string;
  attached?: boolean;
  detached?: boolean;
  attachedAt?: string;
  detachedAt?: string;
  pid?: number;
  cwd?: string;
  branch?: string;
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

  const state = {
    attached: false,
    detached: false,
    attachedAt: undefined as string | undefined,
    detachedAt: undefined as string | undefined,
  };

  const sendResponse = (socket: net.Socket, response: DaemonResponse) => {
    try {
      socket.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      logger.error('Failed to write daemon response', { error: String(error) }, DAEMON_COMPONENT);
    } finally {
      socket.end();
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

    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.includes('\n')) {
        socket.end();
      }
    });

    socket.on('end', () => {
      cleanup();
      const line = buffer.trim();
      if (!line) {
        return;
      }

      let request: DaemonRequest;
      try {
        request = JSON.parse(line) as DaemonRequest;
      } catch (error) {
        sendResponse(socket, { ok: false, error: 'invalid_request' });
        return;
      }

      const action = request.action || 'status';
      if (action === 'status') {
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

      if (action === 'attach' || action === 'reattach') {
        if (state.attached && !state.detached) {
          sendResponse(socket, { ok: false, error: 'already_attached' });
          return;
        }

        state.attached = true;
        state.detached = false;
        state.attachedAt = new Date().toISOString();
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

      if (action === 'detach') {
        state.attached = false;
        state.detached = true;
        state.detachedAt = new Date().toISOString();
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

      sendResponse(socket, { ok: false, error: 'unsupported_action' });
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
