import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import * as net from 'net';

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

export class UdsServerTransport implements Transport {
  private readonly socket: net.Socket;
  private readonly readBuffer = new ReadBuffer();
  private started = false;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T) => void;

  constructor(socket: net.Socket) {
    this.socket = socket;
  }

  async start(): Promise<void> {
    if (this.started) {
      throw new Error('UdsServerTransport already started.');
    }

    this.started = true;
    this.socket.on('data', (chunk) => {
      this.readBuffer.append(chunk);
      this.processReadBuffer();
    });
    this.socket.on('error', (error) => {
      this.onerror?.(error);
    });
    this.socket.on('close', () => {
      this.readBuffer.clear();
      this.onclose?.();
    });
  }

  private processReadBuffer(): void {
    while (true) {
      try {
        const message = this.readBuffer.readMessage();
        if (!message) {
          break;
        }
        this.onmessage?.(message as JSONRPCMessage);
      } catch (error) {
        this.onerror?.(error as Error);
      }
    }
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    return new Promise((resolve) => {
      const payload = serializeMessage(message);
      if (this.socket.write(payload)) {
        resolve();
      } else {
        this.socket.once('drain', resolve);
      }
    });
  }

  async close(): Promise<void> {
    this.socket.end();
    this.onclose?.();
  }
}

export class UdsClientTransport implements Transport {
  private readonly socketPath: string;
  private readonly readBuffer = new ReadBuffer();
  private socket: net.Socket | null = null;
  private started = false;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T) => void;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  async start(): Promise<void> {
    if (this.started) {
      throw new Error('UdsClientTransport already started.');
    }

    this.started = true;
    this.socket = net.connect({ path: this.socketPath }, () => {
      // Connected
    });
    this.socket.on('data', (chunk) => {
      this.readBuffer.append(chunk);
      this.processReadBuffer();
    });
    this.socket.on('error', (error) => {
      this.onerror?.(error);
    });
    this.socket.on('close', () => {
      this.readBuffer.clear();
      this.onclose?.();
    });
  }

  private processReadBuffer(): void {
    while (true) {
      try {
        const message = this.readBuffer.readMessage();
        if (!message) {
          break;
        }
        this.onmessage?.(message as JSONRPCMessage);
      } catch (error) {
        this.onerror?.(error as Error);
      }
    }
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    const socket = this.socket;
    if (!socket) {
      throw new Error('UdsClientTransport not started.');
    }

    return new Promise((resolve) => {
      const payload = serializeMessage(message);
      if (socket.write(payload)) {
        resolve();
      } else {
        socket.once('drain', resolve);
      }
    });
  }

  async close(): Promise<void> {
    this.socket?.end();
    this.onclose?.();
  }
}
