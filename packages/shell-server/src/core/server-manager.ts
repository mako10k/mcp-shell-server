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
  mcpSocketPath?: string;
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
const SOCKET_REQUEST_TIMEOUT_MS = 1000;

type DaemonRequest = {
  action: 'status' | 'info' | 'attach' | 'detach' | 'reattach' | 'stop';
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
  mcpSocketPath?: string;
};

type HeartbeatMessage = {
  type?: 'ping' | 'pong';
};

export class StubServerManager implements ServerManager {
  private readonly createdAt = new Date().toISOString();
  private readonly servers = new Map<
    string,
    {
      socketPath: string;
      server?: net.Server;
      child?: ChildProcess;
      attached: boolean;
      detached: boolean;
      attachSocket?: net.Socket;
    }
  >();

  private getBranch(): string {
    return process.env['MCP_SHELL_SERVER_BRANCH'] || DEFAULT_BRANCH;
  }

  private getRuntimeRoot(): string {
    const runtimeDir = process.env['XDG_RUNTIME_DIR'] || os.tmpdir();
    return path.join(runtimeDir, 'mcp-shell');
  }

  private isDaemonEnabled(): boolean {
    return process.env['MCP_SHELL_DAEMON_ENABLED'] === 'true';
  }

  private hashCwd(cwd: string): string {
    return crypto.createHash('sha256').update(path.resolve(cwd)).digest('hex');
  }

  private buildSocketPath(cwd: string, branch: string): string {
    const runtimeRoot = this.getRuntimeRoot();
    const cwdHash = this.hashCwd(cwd);
    return path.join(runtimeRoot, cwdHash, branch, SOCKET_FILE_NAME);
  }

  private parseServerId(serverId: string): { hash: string; branch: string } | null {
    const [hash, branch] = serverId.split(':');
    if (!hash || !branch) {
      return null;
    }
    return { hash, branch };
  }

  private buildSocketPathFromServerId(serverId: string): string | null {
    const parsed = this.parseServerId(serverId);
    if (!parsed) {
      return null;
    }
    return path.join(this.getRuntimeRoot(), parsed.hash, parsed.branch, SOCKET_FILE_NAME);
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

  private async requestDaemon(socketPath: string, request: DaemonRequest): Promise<DaemonResponse> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ path: socketPath }, () => {
        socket.write(`${JSON.stringify(request)}\n`);
      });

      let buffer = '';
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(
          new MCPShellError('SYSTEM_013', 'Daemon request timed out', 'SYSTEM', {
            socketPath,
            action: request.action,
          })
        );
      }, SOCKET_REQUEST_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
        socket.removeAllListeners();
      };

      socket.setEncoding('utf-8');
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
          reject(
            new MCPShellError('SYSTEM_013', 'Daemon response was empty', 'SYSTEM', {
              socketPath,
              action: request.action,
            })
          );
          return;
        }

        try {
          resolve(JSON.parse(line) as DaemonResponse);
        } catch (error) {
          reject(
            new MCPShellError('SYSTEM_013', 'Failed to parse daemon response', 'SYSTEM', {
              socketPath,
              action: request.action,
              error: String(error),
            })
          );
        }
      });

      socket.on('error', (error) => {
        cleanup();
        reject(
          new MCPShellError('SYSTEM_013', 'Daemon request failed', 'SYSTEM', {
            socketPath,
            action: request.action,
            error: String(error),
          })
        );
      });
    });
  }

  private async openAttachConnection(
    socketPath: string
  ): Promise<{ socket: net.Socket; response: DaemonResponse }> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ path: socketPath }, () => {
        socket.write(`${JSON.stringify({ action: 'attach' })}\n`);
      });

      let buffer = '';
      let responseSent = false;
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(
          new MCPShellError('SYSTEM_013', 'Attach request timed out', 'SYSTEM', {
            socketPath,
          })
        );
      }, SOCKET_REQUEST_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
      };

      const handleHeartbeat = (message: HeartbeatMessage) => {
        if (message.type === 'ping') {
          try {
            socket.write(`${JSON.stringify({ type: 'pong' })}\n`);
          } catch {
            // Ignore write failures on heartbeat.
          }
        }
      };

      socket.setEncoding('utf-8');
      socket.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }

          let parsed: DaemonResponse | HeartbeatMessage;
          try {
            parsed = JSON.parse(trimmed) as DaemonResponse | HeartbeatMessage;
          } catch {
            continue;
          }

          if (!responseSent && 'ok' in parsed) {
            responseSent = true;
            cleanup();
            const response = parsed as DaemonResponse;
            if (!response.ok) {
              socket.end();
              reject(
                new MCPShellError('SYSTEM_013', 'Daemon attach failed', 'SYSTEM', {
                  socketPath,
                  error: response.error,
                })
              );
              return;
            }

            resolve({ socket, response });
            continue;
          }

          handleHeartbeat(parsed as HeartbeatMessage);
        }
      });

      socket.on('error', (error) => {
        cleanup();
        reject(
          new MCPShellError('SYSTEM_013', 'Attach connection failed', 'SYSTEM', {
            socketPath,
            error: String(error),
          })
        );
      });
    });
  }

  private deriveStatus(attached?: boolean, detached?: boolean): ServerStatus {
    if (detached) {
      return 'detached';
    }
    if (attached) {
      return 'running';
    }
    return 'running';
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

      let status: ServerStatus = 'running';
      if (this.isDaemonEnabled()) {
        try {
          const response = await this.requestDaemon(socketPath, { action: 'status' });
          status = this.deriveStatus(response.attached, response.detached);
        } catch {
          status = 'unknown';
        }
      }

      servers.push({
        serverId: `${cwdHash}:${branch}`,
        status,
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

    let status: ServerStatus = 'running';
    if (socketReady && this.isDaemonEnabled()) {
      try {
        const response = await this.requestDaemon(socketPath, { action: 'status' });
        status = this.deriveStatus(response.attached, response.detached);
      } catch {
        status = 'unknown';
      }
    }

    return {
      serverId: 'local',
      status,
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
      const attachable = await Promise.all(
        discovered.map(async (server) => {
          if (!this.isDaemonEnabled() || !server.socketPath) {
            return { ...server, attachable: true };
          }

          try {
            const response = await this.requestDaemon(server.socketPath, { action: 'status' });
            const canAttach = response.attached !== true || response.detached === true;
            return {
              ...server,
              status: this.deriveStatus(response.attached, response.detached),
              attachable: canAttach,
              ...(canAttach ? {} : { reason: 'Already attached' }),
            };
          } catch {
            return {
              ...server,
              attachable: false,
              reason: 'Failed to query daemon status',
            };
          }
        })
      );

      return attachable;
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

    if (this.isDaemonEnabled()) {
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

      this.servers.set(serverId, { socketPath, child, attached: false, detached: false });
    } else {
      const server = net.createServer((socket) => {
        socket.destroy();
      });

      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, () => resolve());
      });

      await fs.chmod(socketPath, 0o600);
      this.servers.set(serverId, { socketPath, server, attached: false, detached: false });
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
      if (this.isDaemonEnabled()) {
        try {
          await this.requestDaemon(entry.socketPath, { action: 'stop' });
        } catch {
          // Best-effort shutdown only.
        }
      }

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

    const parsed = this.parseServerId(options.serverId);
    if (!parsed) {
      throw new MCPShellError('RESOURCE_001', 'Server not found', 'RESOURCE', {
        serverId: options.serverId,
      });
    }

    const socketPath = path.join(this.getRuntimeRoot(), parsed.hash, parsed.branch, SOCKET_FILE_NAME);
    if (await this.socketExists(socketPath)) {
      if (this.isDaemonEnabled() && (await this.canConnectSocket(socketPath))) {
        const response = await this.requestDaemon(socketPath, { action: 'stop' });
        if (!response.ok) {
          throw new MCPShellError('SYSTEM_013', 'Daemon stop failed', 'SYSTEM', {
            serverId: options.serverId,
            error: response.error,
          });
        }
        return;
      }

      await this.cleanupStaleSocket(socketPath);
      return;
    }

    if (options.force) {
      return;
    }

    throw new MCPShellError('RESOURCE_001', 'Server not found', 'RESOURCE', {
      serverId: options.serverId,
    });
  }

  async get(options: ServerLookupOptions): Promise<ServerInfo | null> {
    const entry = this.servers.get(options.serverId);
    if (entry) {
      return {
        serverId: options.serverId,
        status: this.deriveStatus(entry.attached, entry.detached),
        cwd: process.cwd(),
        socketPath: entry.socketPath,
        createdAt: this.createdAt,
        lastSeenAt: new Date().toISOString(),
        pid: entry.child?.pid ?? process.pid,
      };
    }

    const socketPath = this.buildSocketPathFromServerId(options.serverId);
    if (!socketPath || !(await this.socketExists(socketPath))) {
      return null;
    }

    if (this.isDaemonEnabled()) {
      if (!(await this.canConnectSocket(socketPath))) {
        await this.cleanupStaleSocket(socketPath);
        return null;
      }

      const response = await this.requestDaemon(socketPath, { action: 'info' });
      if (!response.ok) {
        return null;
      }

      return {
        serverId: options.serverId,
        status: this.deriveStatus(response.attached, response.detached),
        cwd: response.cwd || process.cwd(),
        ...(response.socketPath ? { socketPath: response.socketPath } : { socketPath }),
        ...(response.mcpSocketPath ? { mcpSocketPath: response.mcpSocketPath } : {}),
        createdAt: response.startedAt || this.createdAt,
        lastSeenAt: new Date().toISOString(),
        ...(typeof response.pid === 'number' ? { pid: response.pid } : {}),
      };
    }

    return {
      serverId: options.serverId,
      status: 'running',
      cwd: process.cwd(),
      socketPath,
      createdAt: this.createdAt,
      lastSeenAt: new Date().toISOString(),
      pid: process.pid,
    };
  }

  async detach(options: ServerAttachOptions): Promise<void> {
    const entry = this.servers.get(options.serverId);
    if (entry) {
      entry.attached = false;
      entry.detached = true;
      if (entry.attachSocket) {
        entry.attachSocket.end();
        entry.attachSocket.destroy();
        delete entry.attachSocket;
      }
      return;
    }

    const socketPath = this.buildSocketPathFromServerId(options.serverId);
    if (!socketPath || !(await this.socketExists(socketPath))) {
      throw new MCPShellError('RESOURCE_001', 'Server not found', 'RESOURCE', {
        serverId: options.serverId,
      });
    }

    if (this.isDaemonEnabled()) {
      const response = await this.requestDaemon(socketPath, { action: 'detach' });
      if (!response.ok) {
        throw new MCPShellError('SYSTEM_013', 'Daemon detach failed', 'SYSTEM', {
          serverId: options.serverId,
          error: response.error,
        });
      }
      return;
    }

    throw new MCPShellError('SYSTEM_010', NOT_IMPLEMENTED_MESSAGE, 'SYSTEM', {
      operation: 'detach',
      serverId: options.serverId,
    });
  }

  async reattach(options: ServerAttachOptions): Promise<ServerInfo> {
    const entry = this.servers.get(options.serverId);
    if (entry) {
      if (entry.attached && !entry.detached) {
        throw new MCPShellError('RESOURCE_006', 'Server is already attached', 'RESOURCE', {
          serverId: options.serverId,
        });
      }

      entry.attached = true;
      entry.detached = false;
      return {
        serverId: options.serverId,
        status: 'running',
        cwd: process.cwd(),
        socketPath: entry.socketPath,
        createdAt: this.createdAt,
        lastSeenAt: new Date().toISOString(),
        pid: entry.child?.pid ?? process.pid,
      };
    }

    const socketPath = this.buildSocketPathFromServerId(options.serverId);
    if (!socketPath || !(await this.socketExists(socketPath))) {
      throw new MCPShellError('RESOURCE_001', 'Server not found', 'RESOURCE', {
        serverId: options.serverId,
      });
    }

    if (this.isDaemonEnabled()) {
      const { socket, response } = await this.openAttachConnection(socketPath);
      if (response.error === 'already_attached') {
        socket.end();
        throw new MCPShellError('RESOURCE_006', 'Server is already attached', 'RESOURCE', {
          serverId: options.serverId,
        });
      }

      this.servers.set(options.serverId, {
        socketPath,
        attached: response.attached === true,
        detached: response.detached === true,
        attachSocket: socket,
      });

      return {
        serverId: options.serverId,
        status: this.deriveStatus(response.attached, response.detached),
        cwd: response.cwd || process.cwd(),
        socketPath,
        createdAt: this.createdAt,
        lastSeenAt: new Date().toISOString(),
        ...(typeof response.pid === 'number' ? { pid: response.pid } : {}),
      };
    }

    throw new MCPShellError('SYSTEM_010', NOT_IMPLEMENTED_MESSAGE, 'SYSTEM', {
      operation: 'reattach',
      serverId: options.serverId,
    });
  }

}
