import { spawn, type ChildProcess } from 'child_process';
import { Dirent } from 'fs';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

import { MCPShellError } from '../utils/errors.js';

export type ServerStatus = 'running' | 'stopped' | 'detached' | 'unknown';

export type ServerInfo = {
  serverId: string;
  status: ServerStatus;
  cwd: string;
  socketPath?: string;
  createdAt?: string;
  lastSeenAt?: string;
  pid?: number;
};

export type AttachableServerInfo = ServerInfo & {
  attachable: boolean;
  reason?: string;
};

export type ServerStartOptions = {
  cwd: string;
  socketPath?: string;
  allowExisting?: boolean;
};

export type ServerStopOptions = {
  serverId: string;
  force?: boolean;
};

export type ServerLookupOptions = {
  serverId: string;
};

export type ServerAttachOptions = {
  serverId: string;
};

export type ListAttachableOptions = {
  cwd: string;
};

export interface ServerManager {
  current(): Promise<ServerInfo | null>;
  listAttachable(options: ListAttachableOptions): Promise<AttachableServerInfo[]>;
  start(options: ServerStartOptions): Promise<ServerInfo>;
  stop(options: ServerStopOptions): Promise<void>;
  get(options: ServerLookupOptions): Promise<ServerInfo | null>;
  detach(options: ServerAttachOptions): Promise<void>;
  reattach(options: ServerAttachOptions): Promise<ServerInfo>;
}

const NOT_IMPLEMENTED_MESSAGE = 'Server management layer is not implemented yet.';
const DEFAULT_BRANCH = 'main';
const SOCKET_FILE_NAME = 'daemon.sock';
const SOCKET_CONNECT_TIMEOUT_MS = 250;
const SOCKET_READY_TIMEOUT_MS = 1000;
const SOCKET_READY_INTERVAL_MS = 50;

export class StubServerManager implements ServerManager {
  private readonly createdAt = new Date().toISOString();
  private readonly servers = new Map<
    string,
    { socketPath: string; server?: net.Server; child?: ChildProcess }
  >();

  private getBranch(): string {
    return process.env['MCP_SHELL_SERVER_BRANCH'] || DEFAULT_BRANCH;
  }

  private getRuntimeRoot(): string {
    const runtimeDir = process.env['XDG_RUNTIME_DIR'] || os.tmpdir();
    return path.join(runtimeDir, 'mcp-shell');
  }

  private hashCwd(cwd: string): string {
    return crypto.createHash('sha256').update(path.resolve(cwd)).digest('hex');
  }

  private buildSocketPath(cwd: string, branch: string): string {
    const runtimeRoot = this.getRuntimeRoot();
    const cwdHash = this.hashCwd(cwd);
    return path.join(runtimeRoot, cwdHash, branch, SOCKET_FILE_NAME);
  }

  private resolveDaemonEntry(): string {
    const override = process.env['MCP_SHELL_DAEMON_ENTRY'];
    if (override) {
      return override;
    }

    return path.resolve(process.cwd(), 'dist/packages/shell-server/src/daemon/server.js');
  }

  private async socketExists(socketPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(socketPath);
      return stat.isSocket();
    } catch {
      return false;
    }
  }

  private async canConnectSocket(socketPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.connect({ path: socketPath }, () => {
        socket.end();
        resolve(true);
      });

      const cleanup = () => {
        socket.removeAllListeners();
      };

      socket.setTimeout(SOCKET_CONNECT_TIMEOUT_MS, () => {
        socket.destroy();
        cleanup();
        resolve(false);
      });

      socket.on('error', () => {
        cleanup();
        resolve(false);
      });
    });
  }

  private async waitForSocketReady(socketPath: string): Promise<boolean> {
    const deadline = Date.now() + SOCKET_READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (await this.canConnectSocket(socketPath)) {
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, SOCKET_READY_INTERVAL_MS));
    }

    return false;
  }

  private async removeIfEmpty(dirPath: string): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath);
      if (entries.length === 0) {
        await fs.rmdir(dirPath);
      }
    } catch {
      // Best-effort cleanup only.
    }
  }

  private async cleanupStaleSocket(socketPath: string): Promise<void> {
    try {
      await fs.unlink(socketPath);
    } catch {
      return;
    }

    const branchDir = path.dirname(socketPath);
    const hashDir = path.dirname(branchDir);
    await this.removeIfEmpty(branchDir);
    await this.removeIfEmpty(hashDir);
  }

  private async listSocketsForCwd(cwd: string): Promise<ServerInfo[]> {
    const runtimeRoot = this.getRuntimeRoot();
    const cwdHash = this.hashCwd(cwd);
    const cwdRoot = path.join(runtimeRoot, cwdHash);

    let branchEntries: Dirent[] = [];
    try {
      branchEntries = await fs.readdir(cwdRoot, { withFileTypes: true });
    } catch {
      return [];
    }

    const servers: ServerInfo[] = [];
    for (const entry of branchEntries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const branch = entry.name;
      const socketPath = path.join(cwdRoot, branch, SOCKET_FILE_NAME);
      if (!(await this.socketExists(socketPath))) {
        continue;
      }

      if (!(await this.canConnectSocket(socketPath))) {
        await this.cleanupStaleSocket(socketPath);
        continue;
      }

      servers.push({
        serverId: `${cwdHash}:${branch}`,
        status: 'running',
        cwd,
        socketPath,
        createdAt: this.createdAt,
        lastSeenAt: new Date().toISOString(),
      });
    }

    return servers;
  }

  async current(): Promise<ServerInfo | null> {
    const cwd = process.cwd();
    const branch = this.getBranch();
    const socketPath = this.buildSocketPath(cwd, branch);
    const socketReady = await this.socketExists(socketPath)
      ? await this.canConnectSocket(socketPath)
      : false;

    if (!socketReady && (await this.socketExists(socketPath))) {
      await this.cleanupStaleSocket(socketPath);
    }

    return {
      serverId: 'local',
      status: 'running',
      cwd,
      ...(socketReady ? { socketPath } : {}),
      createdAt: this.createdAt,
      lastSeenAt: new Date().toISOString(),
      pid: process.pid,
    };
  }

  async listAttachable(_options: ListAttachableOptions): Promise<AttachableServerInfo[]> {
    const resolvedCurrent = path.resolve(process.cwd());
    const resolvedTarget = path.resolve(_options.cwd);
    const discovered = await this.listSocketsForCwd(resolvedTarget);

    if (discovered.length > 0) {
      return discovered.map((server) => ({
        ...server,
        attachable: true,
      }));
    }

    if (resolvedCurrent === resolvedTarget) {
      const current = await this.current();
      if (current) {
        return [
          {
            ...current,
            attachable: true,
          },
        ];
      }
    }

    return [];
  }

  async start(options: ServerStartOptions): Promise<ServerInfo> {
    const cwd = options.cwd;
    const branch = this.getBranch();
    const socketPath = options.socketPath ?? this.buildSocketPath(cwd, branch);
    const serverId = `${this.hashCwd(cwd)}:${branch}`;

    if (await this.socketExists(socketPath)) {
      if (await this.canConnectSocket(socketPath)) {
        if (options.allowExisting) {
          return {
            serverId,
            status: 'running',
            cwd,
            socketPath,
            createdAt: this.createdAt,
            lastSeenAt: new Date().toISOString(),
          };
        }

        throw new MCPShellError('RESOURCE_006', 'Server is already running', 'RESOURCE', {
          socketPath,
        });
      }

      await this.cleanupStaleSocket(socketPath);
    }

    await fs.mkdir(path.dirname(socketPath), { recursive: true });

    if (process.env['MCP_SHELL_DAEMON_ENABLED'] === 'true') {
      const daemonEntry = this.resolveDaemonEntry();
      try {
        await fs.access(daemonEntry);
      } catch (error) {
        throw new MCPShellError('SYSTEM_011', 'Daemon entry not found', 'SYSTEM', {
          daemonEntry,
          error: String(error),
        });
      }

      const child = spawn(
        process.execPath,
        [daemonEntry, '--socket', socketPath, '--cwd', cwd, '--branch', branch],
        {
          detached: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            MCP_SHELL_DAEMON_SOCKET: socketPath,
            MCP_SHELL_DAEMON_CWD: cwd,
            MCP_SHELL_DAEMON_BRANCH: branch,
          },
        }
      );
      child.unref();

      if (!(await this.waitForSocketReady(socketPath))) {
        throw new MCPShellError('SYSTEM_012', 'Daemon socket did not become ready', 'SYSTEM', {
          socketPath,
        });
      }

      this.servers.set(serverId, { socketPath, child });
    } else {
      const server = net.createServer((socket) => {
        socket.destroy();
      });

      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, () => resolve());
      });

      await fs.chmod(socketPath, 0o600);
      this.servers.set(serverId, { socketPath, server });
    }

    return {
      serverId,
      status: 'running',
      cwd,
      socketPath,
      createdAt: this.createdAt,
      lastSeenAt: new Date().toISOString(),
      pid: process.pid,
    };
  }

  async stop(options: ServerStopOptions): Promise<void> {
    const entry = this.servers.get(options.serverId);
    if (entry) {
      if (entry.server) {
        await new Promise<void>((resolve) => {
          entry.server?.close(() => resolve());
        });
      }

      if (entry.child?.pid) {
        try {
          process.kill(entry.child.pid);
        } catch {
          // Best-effort shutdown only.
        }
      }

      this.servers.delete(options.serverId);
      await this.cleanupStaleSocket(entry.socketPath);
      return;
    }

    const [hash, branch] = options.serverId.split(':');
    if (!hash || !branch) {
      throw new MCPShellError('RESOURCE_001', 'Server not found', 'RESOURCE', {
        serverId: options.serverId,
      });
    }

    const socketPath = path.join(this.getRuntimeRoot(), hash, branch, SOCKET_FILE_NAME);
    if (await this.socketExists(socketPath)) {
      await this.cleanupStaleSocket(socketPath);
      return;
    }

    throw new MCPShellError('RESOURCE_001', 'Server not found', 'RESOURCE', {
      serverId: options.serverId,
    });
  }

  async get(options: ServerLookupOptions): Promise<ServerInfo | null> {
    throw new MCPShellError('SYSTEM_010', NOT_IMPLEMENTED_MESSAGE, 'SYSTEM', {
      operation: 'get',
      serverId: options.serverId,
    });
  }

  async detach(options: ServerAttachOptions): Promise<void> {
    throw new MCPShellError('SYSTEM_010', NOT_IMPLEMENTED_MESSAGE, 'SYSTEM', {
      operation: 'detach',
      serverId: options.serverId,
    });
  }

  async reattach(options: ServerAttachOptions): Promise<ServerInfo> {
    throw new MCPShellError('SYSTEM_010', NOT_IMPLEMENTED_MESSAGE, 'SYSTEM', {
      operation: 'reattach',
      serverId: options.serverId,
    });
  }
}
