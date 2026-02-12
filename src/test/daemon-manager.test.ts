import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

import { StubServerManager } from '../../packages/shell-server/src/core/server-manager.js';

type DaemonState = {
  attached: boolean;
  detached: boolean;
  attachedAt?: string;
  detachedAt?: string;
};

function buildSocketPath(cwd: string, branch: string, runtimeDir: string): string {
  const runtimeRoot = path.join(runtimeDir, 'mcp-shell');
  const cwdHash = crypto.createHash('sha256').update(path.resolve(cwd)).digest('hex');
  return path.join(runtimeRoot, cwdHash, branch, 'daemon.sock');
}

async function createFakeDaemon(socketPath: string, state: DaemonState): Promise<{
  close: () => Promise<void>;
}> {
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
    let buffer = '';
    let handled = false;

    const sendResponse = (response: Record<string, unknown>, close: boolean = true) => {
      try {
        socket.write(`${JSON.stringify(response)}\n`);
      } finally {
        if (close) {
          socket.end();
        }
      }
    };

    const handleRequest = () => {
      if (handled) {
        return;
      }
      handled = true;

      const line = buffer.split('\n')[0]?.trim();
      if (!line) {
        return;
      }

      let request: { action?: string };
      try {
        request = JSON.parse(line) as { action?: string };
      } catch {
        sendResponse({ ok: false, error: 'invalid_request' });
        return;
      }

      const action = request.action || 'status';
      if (action === 'status' || action === 'info') {
        sendResponse({
          ok: true,
          attached: state.attached,
          detached: state.detached,
          ...(state.attachedAt ? { attachedAt: state.attachedAt } : {}),
          ...(state.detachedAt ? { detachedAt: state.detachedAt } : {}),
        });
        return;
      }

      if (action === 'attach' || action === 'reattach') {
        if (state.attached && !state.detached) {
          sendResponse({ ok: false, error: 'already_attached' });
          return;
        }

        state.attached = true;
        state.detached = false;
        state.attachedAt = new Date().toISOString();

        socket.on('close', () => {
          state.attached = false;
          state.detached = true;
          state.detachedAt = new Date().toISOString();
        });
        socket.on('error', () => {
          state.attached = false;
          state.detached = true;
          state.detachedAt = new Date().toISOString();
        });

        sendResponse(
          {
            ok: true,
            attached: state.attached,
            detached: state.detached,
            ...(state.attachedAt ? { attachedAt: state.attachedAt } : {}),
          },
          false
        );
        return;
      }

      if (action === 'detach') {
        state.attached = false;
        state.detached = true;
        state.detachedAt = new Date().toISOString();
        sendResponse({ ok: true, attached: state.attached, detached: state.detached });
        return;
      }

      if (action === 'stop') {
        sendResponse({ ok: true });
        server.close();
        return;
      }

      sendResponse({ ok: false, error: 'unsupported_action' });
    };

    socket.setEncoding('utf-8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.includes('\n')) {
        handleRequest();
      }
    });
    socket.on('end', handleRequest);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });
  await fs.chmod(socketPath, 0o600);

  return {
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(socketPath, { force: true });
    },
  };
}

describe('StubServerManager daemon integration', () => {
  let envSnapshot: Record<string, string | undefined>;
  let runtimeDir: string;
  let tempCwd: string;

  beforeEach(async () => {
    envSnapshot = {
      MCP_SHELL_DAEMON_ENABLED: process.env['MCP_SHELL_DAEMON_ENABLED'],
      MCP_SHELL_SERVER_BRANCH: process.env['MCP_SHELL_SERVER_BRANCH'],
      XDG_RUNTIME_DIR: process.env['XDG_RUNTIME_DIR'],
    };

    runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-shell-runtime-'));
    tempCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-shell-cwd-'));

    process.env['XDG_RUNTIME_DIR'] = runtimeDir;
    process.env['MCP_SHELL_SERVER_BRANCH'] = 'test';
  });

  afterEach(async () => {
    process.env['MCP_SHELL_DAEMON_ENABLED'] = envSnapshot.MCP_SHELL_DAEMON_ENABLED;
    process.env['MCP_SHELL_SERVER_BRANCH'] = envSnapshot.MCP_SHELL_SERVER_BRANCH;
    process.env['XDG_RUNTIME_DIR'] = envSnapshot.XDG_RUNTIME_DIR;

    await fs.rm(runtimeDir, { recursive: true, force: true });
    await fs.rm(tempCwd, { recursive: true, force: true });
  });

  it('removes stale sockets when discovery fails to connect', async () => {
    process.env['MCP_SHELL_DAEMON_ENABLED'] = 'false';

    const socketPath = buildSocketPath(tempCwd, 'test', runtimeDir);
    await fs.mkdir(path.dirname(socketPath), { recursive: true });

    const server = net.createServer((socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => resolve());
    });
    await fs.chmod(socketPath, 0o600);
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const serverManager = new StubServerManager();
    await serverManager.listAttachable({ cwd: tempCwd });

    await expect(fs.stat(socketPath)).rejects.toBeTruthy();
  });

  it('marks already attached daemons as not attachable', async () => {
    process.env['MCP_SHELL_DAEMON_ENABLED'] = 'true';

    const socketPath = buildSocketPath(tempCwd, 'test', runtimeDir);
    const state: DaemonState = { attached: true, detached: false };
    const daemon = await createFakeDaemon(socketPath, state);

    const serverManager = new StubServerManager();
    const results = await serverManager.listAttachable({ cwd: tempCwd });

    expect(results).toHaveLength(1);
    expect(results[0]?.attachable).toBe(false);
    expect(results[0]?.reason).toBe('Already attached');

    await daemon.close();
  });

  it('reattach uses the daemon attach handshake', async () => {
    process.env['MCP_SHELL_DAEMON_ENABLED'] = 'true';

    const socketPath = buildSocketPath(tempCwd, 'test', runtimeDir);
    const state: DaemonState = { attached: false, detached: true };
    const daemon = await createFakeDaemon(socketPath, state);

    const serverId = `${crypto.createHash('sha256').update(path.resolve(tempCwd)).digest('hex')}:test`;
    const serverManager = new StubServerManager();
    const info = await serverManager.reattach({ serverId });

    expect(info.status).toBe('running');
    expect(info.socketPath).toBe(socketPath);

    await serverManager.detach({ serverId });
    await daemon.close();
  });
});
