import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

import { StubServerManager } from '../../packages/shell-server/src/core/server-manager.js';

type EnvSnapshot = Record<string, string | undefined>;

function hashCwd(cwd: string): string {
  return crypto.createHash('sha256').update(path.resolve(cwd)).digest('hex');
}

function buildSocketPath(cwd: string, branch: string, runtimeDir: string): string {
  return path.join(runtimeDir, 'mcp-shell', hashCwd(cwd), branch, 'daemon.sock');
}

async function waitForSocketReady(socketPath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const stat = await fs.stat(socketPath);
      if (stat.isSocket()) {
        await new Promise<void>((resolve, reject) => {
          const socket = net.connect({ path: socketPath }, () => {
            socket.end();
            resolve();
          });
          socket.on('error', reject);
        });
        return;
      }
    } catch {
      // Retry until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error('Timed out waiting for daemon socket to be ready.');
}

async function openAttachSocket(socketPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ path: socketPath }, () => {
      socket.write(`${JSON.stringify({ action: 'attach' })}\n`);
    });

    let buffer = '';
    socket.setEncoding('utf-8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (!buffer.includes('\n')) {
        return;
      }
      const line = buffer.split('\n')[0]?.trim();
      if (!line) {
        return;
      }
      try {
        const parsed = JSON.parse(line) as { ok?: boolean; error?: string };
        if (parsed.ok) {
          resolve(socket);
          return;
        }
        reject(new Error(parsed.error || 'attach_failed'));
      } catch (error) {
        reject(error as Error);
      }
    });
    socket.on('error', reject);
  });
}

async function spawnDaemon(socketPath: string, cwd: string, pidFile: string): Promise<ChildProcess> {
  const tsxPath = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
  const child = spawn(
    process.execPath,
    [tsxPath, 'packages/shell-server/src/daemon/server.ts', '--socket', socketPath, '--cwd', cwd, '--branch', 'test'],
    {
      stdio: 'ignore',
      env: {
        ...process.env,
        MCP_SHELL_MCP_DAEMON_ENTRY: path.join(
          process.cwd(),
          'src',
          'test',
          'fixtures',
          'mcp-daemon-child.js'
        ),
        MCP_SHELL_MCP_CHILD_PID_FILE: pidFile,
      },
    }
  );

  await waitForSocketReady(socketPath, 3000);
  return child;
}

async function waitForFile(pathname: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await fs.access(pathname);
      return;
    } catch {
      // Retry until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for file: ${pathname}`);
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for process ${pid} to exit.`);
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 2000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

describe('Daemon integration', () => {
  let envSnapshot: EnvSnapshot;
  let runtimeDir: string;
  let tempCwd: string;
  let socketPath: string;
  let mcpSocketPath: string;
  let serverId: string;
  let pidFile: string;
  let child: ChildProcess | null = null;

  beforeEach(async () => {
    envSnapshot = {
      MCP_SHELL_DAEMON_ENABLED: process.env['MCP_SHELL_DAEMON_ENABLED'],
      MCP_SHELL_SERVER_BRANCH: process.env['MCP_SHELL_SERVER_BRANCH'],
      XDG_RUNTIME_DIR: process.env['XDG_RUNTIME_DIR'],
    };

    runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-shell-runtime-'));
    tempCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-shell-cwd-'));
    socketPath = buildSocketPath(tempCwd, 'test', runtimeDir);
    mcpSocketPath = path.join(path.dirname(socketPath), 'mcp.sock');
    serverId = `${hashCwd(tempCwd)}:test`;
    pidFile = path.join(runtimeDir, 'mcp-child.pid');

    process.env['XDG_RUNTIME_DIR'] = runtimeDir;
    process.env['MCP_SHELL_SERVER_BRANCH'] = 'test';
    process.env['MCP_SHELL_DAEMON_ENABLED'] = 'true';

    child = await spawnDaemon(socketPath, tempCwd, pidFile);
  });

  afterEach(async () => {
    try {
      const serverManager = new StubServerManager();
      await serverManager.stop({ serverId, force: true });
    } catch {
      // Best-effort shutdown only.
    }

    if (child) {
      child.kill('SIGTERM');
      await waitForExit(child);
    }

    process.env['MCP_SHELL_DAEMON_ENABLED'] = envSnapshot.MCP_SHELL_DAEMON_ENABLED;
    process.env['MCP_SHELL_SERVER_BRANCH'] = envSnapshot.MCP_SHELL_SERVER_BRANCH;
    process.env['XDG_RUNTIME_DIR'] = envSnapshot.XDG_RUNTIME_DIR;

    await fs.rm(runtimeDir, { recursive: true, force: true });
    await fs.rm(tempCwd, { recursive: true, force: true });
  });

  it('attaches to the real daemon and observes detach', async () => {
    const serverManager = new StubServerManager();

    const info = await serverManager.reattach({ serverId });
    expect(info.status).toBe('running');
    expect(info.socketPath).toBe(socketPath);

    const attachableBefore = await serverManager.listAttachable({ cwd: tempCwd });
    expect(attachableBefore[0]?.attachable).toBe(false);

    await serverManager.detach({ serverId });

    const attachableAfter = await serverManager.listAttachable({ cwd: tempCwd });
    expect(attachableAfter[0]?.attachable).toBe(true);
  });

  it('stops the daemon and terminates the MCP child process', async () => {
    await waitForFile(pidFile, 2000);

    const pidText = await fs.readFile(pidFile, 'utf-8');
    const pid = Number.parseInt(pidText, 10);
    expect(Number.isNaN(pid)).toBe(false);

    const serverManager = new StubServerManager();
    await serverManager.stop({ serverId, force: true });

    await waitForProcessExit(pid, 2000);
  });

  it('cleans up the MCP socket on daemon stop', async () => {
    await waitForSocketReady(mcpSocketPath, 2000);

    const serverManager = new StubServerManager();
    await serverManager.stop({ serverId, force: true });

    await expect(fs.stat(mcpSocketPath)).rejects.toBeTruthy();
  });

  it('allows repeated stop calls with force enabled', async () => {
    const serverManager = new StubServerManager();
    await serverManager.stop({ serverId, force: true });
    await serverManager.stop({ serverId, force: true });
  });

  it('closes attach sockets when the daemon stops', async () => {
    const attachSocket = await openAttachSocket(socketPath);
    const closePromise = new Promise<void>((resolve) => {
      attachSocket.once('close', () => resolve());
      attachSocket.once('end', () => resolve());
    });

    const serverManager = new StubServerManager();
    await serverManager.stop({ serverId, force: true });

    await closePromise;
  });

  it('can reattach after daemon restart', async () => {
    const attachSocket = await openAttachSocket(socketPath);
    const closePromise = new Promise<void>((resolve) => {
      attachSocket.once('close', () => resolve());
      attachSocket.once('end', () => resolve());
    });

    const serverManager = new StubServerManager();
    await serverManager.stop({ serverId, force: true });
    await closePromise;

    if (child) {
      await waitForExit(child);
    }
    child = await spawnDaemon(socketPath, tempCwd, pidFile);

    const info = await serverManager.reattach({ serverId });
    expect(info.status).toBe('running');
  });
});
