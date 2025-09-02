import http from 'http';
import { URL } from 'url';
import { randomUUID } from 'crypto';
import { listenServer, closeServer } from '../utils/server-helpers.js';

type Json = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

export class ExecutorServer {
  private server: http.Server | null = null;
  private readonly host: string;
  private readonly port: number;
  private readonly startedAt: number = Date.now();
  // Minimal in-memory execution store for Phase 1
  private executions: Map<string, {
    execution_id: string;
    command: string | undefined;
    status: 'accepted' | 'queued' | 'running' | 'completed' | 'failed';
    created_at: string;
    updated_at: string;
  safety_evaluation?: unknown;
  }> = new Map();

  constructor(host?: string, port?: number) {
    this.host = host || process.env['EXECUTOR_HOST'] || '127.0.0.1';
    this.port = port || Number(process.env['EXECUTOR_PORT'] || 4030);
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = http.createServer(async (req, res) => {
      try {
        if (!req.url) return this.json(res, 400, { error: 'Bad Request' });
        const url = new URL(req.url, `http://${this.host}:${this.port}`);
        const { pathname } = url;

        // localhost only
        const remote = req.socket.remoteAddress || '';
        if (!this.isLocalAddress(remote)) return this.json(res, 403, { error: 'Forbidden' });

        if (req.method === 'GET' && pathname === '/health') {
          return this.json(res, 200, {
            status: 'ok',
            uptime_s: Math.floor((Date.now() - this.startedAt) / 1000),
            version: process.env['npm_package_version'] || '0.0.0',
          });
        }

        if (req.method === 'POST' && pathname === '/v1/exec') {
          const body = await this.readJson(req, 64 * 1024);
          const execution_id = (body && typeof body === 'object' && 'execution_id' in body)
            ? String((body as Record<string, unknown>)['execution_id'])
            : randomUUID();
          const cmd = (body && typeof body === 'object' && 'command' in body)
            ? String((body as Record<string, unknown>)['command'])
            : undefined;
          const now = new Date().toISOString();
          const safety = (body && typeof body === 'object' && 'safety_evaluation' in body)
            ? (body as Record<string, unknown>)['safety_evaluation']
            : undefined;
          // Minimal: store as accepted (queueing placeholder)
          this.executions.set(execution_id, {
            execution_id,
            command: cmd,
            status: 'accepted',
            created_at: now,
            updated_at: now,
            safety_evaluation: safety,
          });
          return this.json(res, 202, { execution_id, status: 'accepted' });
        }

        if (req.method === 'GET' && pathname.startsWith('/v1/exec/')) {
          const id = pathname.replace('/v1/exec/', '');
          const item = this.executions.get(id);
          if (!item) return this.json(res, 404, { error: 'Not Found', execution_id: id });
          return this.json(res, 200, item);
        }

        this.json(res, 404, { error: 'Not Found' });
      } catch (e) {
        this.json(res, 500, { error: 'Internal Error' });
      }
    });

  await listenServer(this.server as http.Server, this.host, this.port);
  }

  async stop(): Promise<void> {
  const srv = this.server;
  if (!srv) return;
  await closeServer(srv);
    this.server = null;
  }

  private json(res: http.ServerResponse, status: number, data: Json) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(typeof data === 'string' ? data : JSON.stringify(data));
  }

  private async readJson(req: http.IncomingMessage, maxSize = 65536): Promise<Json> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > maxSize) throw new Error('Payload too large');
      chunks.push(buf);
    }
    const raw = Buffer.concat(chunks).toString('utf-8');
    if (!raw) return {};
    try { return JSON.parse(raw) as Json; } catch { return {}; }
  }

  private isLocalAddress(addr: string): boolean {
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1' || !addr;
  }
}

// Optional autostart when EXECUTOR_AUTOSTART=true (for local dev only)
if (process.env['EXECUTOR_AUTOSTART'] === 'true') {
  const srv = new ExecutorServer();
  void srv.start();
}
