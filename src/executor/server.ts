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
  exit_code?: number;
  stdout?: string;
  stderr?: string;
  execution_time_ms?: number;
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
          if (!cmd || cmd.trim().length === 0) {
            return this.json(res, 400, { error: 'command is required' });
          }
          const cwd = (body && typeof body === 'object' && 'working_directory' in body && typeof (body as Record<string, unknown>)['working_directory'] === 'string')
            ? String((body as Record<string, unknown>)['working_directory'])
            : process.cwd();
          const timeoutSeconds = (body && typeof body === 'object' && 'timeout_seconds' in body && typeof (body as Record<string, unknown>)['timeout_seconds'] === 'number')
            ? Number((body as Record<string, unknown>)['timeout_seconds'])
            : 60;
          const captureStderr = !body || typeof body !== 'object' || !('capture_stderr' in body) || Boolean((body as Record<string, unknown>)['capture_stderr']);
          const maxOutputSize = (body && typeof body === 'object' && 'max_output_size' in body && typeof (body as Record<string, unknown>)['max_output_size'] === 'number')
            ? Math.max(1024, Number((body as Record<string, unknown>)['max_output_size']))
            : 5 * 1024 * 1024; // 5MB
          const now = new Date().toISOString();
          const safety = (body && typeof body === 'object' && 'safety_evaluation' in body)
            ? (body as Record<string, unknown>)['safety_evaluation']
            : undefined;
          // Minimal: store as accepted (queueing placeholder)
          this.executions.set(execution_id, {
            execution_id,
            command: cmd,
            status: 'running',
            created_at: now,
            updated_at: now,
            safety_evaluation: safety,
          });
          // Start execution asynchronously
          this.runCommand(execution_id, cmd, { cwd, timeoutSeconds, captureStderr, maxOutputSize }).catch(() => {
            // swallow
          });
          return this.json(res, 202, { execution_id, status: 'running' });
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

  private async runCommand(
    executionId: string,
    command: string,
    opts: { cwd: string; timeoutSeconds: number; captureStderr: boolean; maxOutputSize: number }
  ): Promise<void> {
    const start = Date.now();
    // Lazy import to avoid top-level dependency if not used
    const { spawn } = await import('child_process');
    const child = spawn('sh', ['-c', command], { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    const addChunk = (src: 'out' | 'err', chunk: Buffer | string) => {
      const str = Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
      if (src === 'out') {
        if (stdout.length < opts.maxOutputSize) {
          const remain = opts.maxOutputSize - stdout.length;
          stdout += str.slice(0, Math.max(0, remain));
        }
      } else {
        if (stderr.length < opts.maxOutputSize) {
          const remain = opts.maxOutputSize - stderr.length;
          stderr += str.slice(0, Math.max(0, remain));
        }
      }
    };

    if (child.stdout) child.stdout.on('data', (d) => addChunk('out', d));
    if (opts.captureStderr && child.stderr) child.stderr.on('data', (d) => addChunk('err', d));

    let killedByTimeout = false;
    const timer = setTimeout(() => {
      killedByTimeout = true;
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 1000);
    }, Math.max(1, opts.timeoutSeconds) * 1000);

    const finalize = (status: 'completed' | 'failed', exitCode?: number) => {
      clearTimeout(timer);
      const rec = this.executions.get(executionId);
      if (!rec) return;
      rec.status = status;
      if (typeof exitCode === 'number') {
        rec.exit_code = exitCode;
      } else {
        // exactOptionalPropertyTypes: optional props should be omitted, not set to undefined
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete (rec as Record<string, unknown>)['exit_code'];
      }
      rec.stdout = stdout;
      if (opts.captureStderr) rec.stderr = stderr;
      rec.execution_time_ms = Date.now() - start;
      rec.updated_at = new Date().toISOString();
      this.executions.set(executionId, rec);
    };

    child.on('error', () => finalize('failed'));
    child.on('exit', (code) => finalize(killedByTimeout ? 'failed' : (code === 0 ? 'completed' : 'failed'), code === null ? undefined : code));
  }
}

// Optional autostart when EXECUTOR_AUTOSTART=true (for local dev only)
if (process.env['EXECUTOR_AUTOSTART'] === 'true') {
  const srv = new ExecutorServer();
  void srv.start();
}
