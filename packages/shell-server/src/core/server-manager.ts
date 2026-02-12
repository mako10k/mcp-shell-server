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

export class StubServerManager implements ServerManager {
  private readonly createdAt = new Date().toISOString();

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

    let branchEntries: fs.Dirent[] = [];
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
    const runtimeRoot = this.getRuntimeRoot();
    const cwdHash = this.hashCwd(cwd);
    const socketPath = path.join(runtimeRoot, cwdHash, branch, SOCKET_FILE_NAME);

    return {
      serverId: 'local',
      status: 'running',
      cwd,
      socketPath: (await this.socketExists(socketPath)) ? socketPath : undefined,
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
    throw new MCPShellError('SYSTEM_010', NOT_IMPLEMENTED_MESSAGE, 'SYSTEM', {
      operation: 'start',
      cwd: options.cwd,
    });
  }

  async stop(options: ServerStopOptions): Promise<void> {
    throw new MCPShellError('SYSTEM_010', NOT_IMPLEMENTED_MESSAGE, 'SYSTEM', {
      operation: 'stop',
      serverId: options.serverId,
      force: options.force ?? false,
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
