import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs/promises';
import { logger } from '../../shell-server/src/utils/helpers.js';
import { UdsClientTransport } from '../../shell-server/src/daemon/uds-transport.js';

class ReadBuffer {
  private buffer: Buffer | undefined;

  append(chunk: Buffer): void {
    this.buffer = this.buffer ? Buffer.concat([this.buffer, chunk]) : chunk;
  }

  readMessage(): JSONRPCMessage | null {
    if (!this.buffer) {
      return null;
    }

    const index = this.buffer.indexOf('\n');
    if (index === -1) {
      return null;
    }

    const line = this.buffer.toString('utf8', 0, index).replace(/\r$/, '');
    this.buffer = this.buffer.subarray(index + 1);
    return JSONRPCMessageSchema.parse(JSON.parse(line));
  }

  clear(): void {
    this.buffer = undefined;
  }
}

function serializeMessage(message: JSONRPCMessage): string {
  return `${JSON.stringify(message)}\n`;
}

async function validateSocketPermissions(socketPath: string): Promise<void> {
  const stat = await fs.stat(socketPath);
  if (!stat.isSocket()) {
    throw new Error('Socket path is not a Unix domain socket.');
  }

  const mode = stat.mode & 0o777;
  if (mode !== 0o600) {
    throw new Error('Socket permissions must be 600.');
  }

  const getuid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (getuid !== null && stat.uid !== getuid) {
    throw new Error('Socket owner does not match current user.');
  }
}

export async function runDaemonProxy(socketPath: string): Promise<void> {
  try {
    await validateSocketPermissions(socketPath);
  } catch (error) {
    logger.error(
      'MCP daemon socket validation failed',
      { error: String(error), socketPath },
      'daemon-proxy'
    );
    throw error;
  }

  const transport = new UdsClientTransport(socketPath);
  const readBuffer = new ReadBuffer();

  transport.onmessage = (message) => {
    try {
      const payload = serializeMessage(message as JSONRPCMessage);
      process.stdout.write(payload);
    } catch (error) {
      logger.error('Failed to write daemon message', { error: String(error) }, 'daemon-proxy');
    }
  };

  transport.onerror = (error) => {
    const code = (error as NodeJS.ErrnoException).code;
    const message = (() => {
      if (code === 'ENOENT') {
        return 'Daemon socket not found. Start the daemon or check MCP_SHELL_DAEMON_ENABLED.';
      }
      if (code === 'EACCES') {
        return 'Permission denied connecting to daemon socket. Check file permissions and ownership.';
      }
      if (code === 'ECONNREFUSED') {
        return 'Daemon socket refused connection. The daemon may be down.';
      }
      return 'Daemon transport error.';
    })();

    logger.error(
      message,
      { error: String(error), code, socketPath },
      'daemon-proxy'
    );
  };

  transport.onclose = () => {
    logger.info('Daemon transport closed', {}, 'daemon-proxy');
    process.exit(0);
  };

  await transport.start();

  process.stdin.on('data', (chunk) => {
    readBuffer.append(chunk);
    while (true) {
      let message: JSONRPCMessage | null = null;
      try {
        message = readBuffer.readMessage();
      } catch (error) {
        logger.error('Failed to parse daemon proxy message', { error: String(error) }, 'daemon-proxy');
        break;
      }

      if (!message) {
        break;
      }

      transport.send(message).catch((error) => {
        logger.error('Failed to send daemon proxy message', { error: String(error) }, 'daemon-proxy');
      });
    }
  });

  process.stdin.on('close', () => {
    readBuffer.clear();
    transport.close().catch((error) => {
      logger.error('Failed to close daemon proxy transport', { error: String(error) }, 'daemon-proxy');
    });
  });
}
