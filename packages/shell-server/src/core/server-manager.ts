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

export class StubServerManager implements ServerManager {
  private readonly createdAt = new Date().toISOString();

  async current(): Promise<ServerInfo | null> {
    return {
      serverId: 'local',
      status: 'running',
      cwd: process.cwd(),
      createdAt: this.createdAt,
      lastSeenAt: new Date().toISOString(),
      pid: process.pid,
    };
  }

  async listAttachable(_options: ListAttachableOptions): Promise<AttachableServerInfo[]> {
    const resolvedCurrent = path.resolve(process.cwd());
    const resolvedTarget = path.resolve(_options.cwd);
    const current = await this.current();

    if (!current) {
      return [];
    }

    if (resolvedCurrent !== resolvedTarget) {
      return [
        {
          ...current,
          attachable: false,
          reason: 'Different working directory boundary',
        },
      ];
    }

    return [
      {
        ...current,
        attachable: true,
      },
    ];
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
