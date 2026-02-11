import http from 'http';
import { EventEmitter } from 'events';
import { URL } from 'url';
import { randomUUID } from 'crypto';
import { listenServer, closeServer } from '../utils/server-helpers.js';
import { startHeartbeat } from '../utils/sse.js';

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
  // Track running child processes for kill API
  private processes: Map<string, import('child_process').ChildProcess> = new Map();
  // 簡易イベント: 実行ごとの出力更新/終了を通知（BackofficeのSSE移行の布石）
  private events = new EventEmitter();

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
          const inputData = (body && typeof body === 'object' && 'input_data' in body && typeof (body as Record<string, unknown>)['input_data'] === 'string')
            ? String((body as Record<string, unknown>)['input_data'])
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
          const runOpts: { cwd: string; timeoutSeconds: number; captureStderr: boolean; maxOutputSize: number; inputData?: string } = { cwd, timeoutSeconds, captureStderr, maxOutputSize };
          if (typeof inputData === 'string') (runOpts as Record<string, unknown>)['inputData'] = inputData;
          this.runCommand(execution_id, cmd, runOpts).catch(() => {
            // swallow
          });
          return this.json(res, 202, { execution_id, status: 'running' });
        }

        if (req.method === 'GET' && pathname.startsWith('/v1/exec/')) {
          const rest = pathname.replace('/v1/exec/', '');
          const [idRaw, sub] = rest.split('/');
          const id = idRaw || '';
          if (!id) return this.json(res, 400, { error: 'Invalid execution id' });
          const item = this.executions.get(id);
          if (!item) return this.json(res, 404, { error: 'Not Found', execution_id: id });
          if (!sub) {
            return this.json(res, 200, item);
          }
          // Outputs endpoint
          if (sub === 'outputs') {
            const out: Record<string, unknown> = { execution_id: id };
            if (typeof item.stdout === 'string') out['stdout'] = item.stdout;
            if (typeof item.stderr === 'string') out['stderr'] = item.stderr;
            return this.json(res, 200, out);
          }
          // SSE endpoint for live updates
          if (sub === 'sse') {
            return this.handleExecSSE(res, id, req);
          }
          return this.json(res, 404, { error: 'Not Found' });
        }

        // Kill endpoint
        if (req.method === 'POST' && pathname.startsWith('/v1/exec/') && pathname.endsWith('/kill')) {
          const id = pathname.split('/')[3] || '';
          if (!this.executions.has(id)) return this.json(res, 404, { error: 'Not Found', execution_id: id });
          const proc = this.processes.get(id);
          const body = await this.readJson(req, 16 * 1024);
          const force = !!(body && typeof body === 'object' && 'force' in body && (body as Record<string, unknown>)['force']);
          const signal = (body && typeof body === 'object' && 'signal' in body)
            ? String((body as Record<string, unknown>)['signal'])
            : 'SIGTERM';
          if (!proc || proc.killed) {
            return this.json(res, 200, { success: true, message: 'No running process', execution_id: id });
          }
          try {
            const ok = proc.kill(signal as NodeJS.Signals);
            if (force) setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 1000);
            return this.json(res, 200, { success: ok, signal_sent: signal, execution_id: id });
          } catch (e) {
            return this.json(res, 500, { success: false, error: 'Kill failed', execution_id: id });
          }
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

  private initSSE(res: http.ServerResponse) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
  }

  private writeSSE(res: http.ServerResponse, event: string, data: unknown) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    res.write(`event: ${event}\n`);
    for (const line of String(payload).split(/\r?\n/)) {
      res.write(`data: ${line}\n`);
    }
    res.write('\n');
  }

  private async handleExecSSE(res: http.ServerResponse, id: string, req: http.IncomingMessage) {
    this.initSSE(res);
    const item = this.executions.get(id);
    if (!item) {
      this.writeSSE(res, 'error', { message: 'Not Found', execution_id: id });
      res.end();
      return;
    }

        // 初期スナップショット
        this.writeSSE(res, 'state', item);
        const out: Record<string, unknown> = { execution_id: id };
        if (typeof item.stdout === 'string') out['stdout'] = item.stdout;
        if (typeof item.stderr === 'string') out['stderr'] = item.stderr;
        this.writeSSE(res, 'outputs', out);

    const onOutput = () => {
      const current = this.executions.get(id);
      if (!current) return;
      this.writeSSE(res, 'state', current);
      const o: Record<string, unknown> = { execution_id: id };
      if (typeof current.stdout === 'string') o['stdout'] = current.stdout;
      if (typeof current.stderr === 'string') o['stderr'] = current.stderr;
      this.writeSSE(res, 'outputs', o);
    };
    const onExit = () => {
      const current = this.executions.get(id);
      if (current) this.writeSSE(res, 'state', current);
      this.writeSSE(res, 'end', { reason: 'finished' });
      cleanup();
      res.end();
    };

    const cleanup = () => {
      this.events.removeListener(`exec:output:${id}`, onOutput);
      this.events.removeListener(`exec:exit:${id}`, onExit);
      if (heartbeat) clearInterval(heartbeat);
    };

    this.events.on(`exec:output:${id}`, onOutput);
    this.events.on(`exec:exit:${id}`, onExit);

    // ハートビート
    const heartbeat = startHeartbeat((event, data) => this.writeSSE(res, event, data));

    req.on('close', cleanup);
    req.on('aborted', cleanup);
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
    opts: { cwd: string; timeoutSeconds: number; captureStderr: boolean; maxOutputSize: number; inputData?: string }
  ): Promise<void> {
    const start = Date.now();
    // Lazy import to avoid top-level dependency if not used
  const { spawn } = await import('child_process');
  const child = spawn('sh', ['-c', command], { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  this.processes.set(executionId, child);

    // Fail-fast, backpressure-aware stdin write if provided
    if (opts.inputData && child.stdin) {
      try {
        await new Promise<void>((resolve, reject) => {
          const onErr = (err: unknown) => reject(err instanceof Error ? err : new Error(String(err)));
          child.stdin.once('error', onErr);
          const endSafely = () => {
            try { child.stdin.end(); } catch { /* stream may already be closed */ }
            resolve();
          };
          const ok = child.stdin.write(opts.inputData, (err?: Error | null) => {
            if (err) return onErr(err);
            endSafely();
          });
          if (!ok) {
            // Handle backpressure: wait for drain then end
            child.stdin.once('drain', endSafely);
          }
        });
      } catch (e) {
        // Input write failed: terminate process promptly (fail fast)
        try { child.kill('SIGTERM'); } catch {}
      }
    }

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

  if (child.stdout) child.stdout.on('data', (d) => {
      addChunk('out', d);
      const rec = this.executions.get(executionId);
      if (rec) {
        rec.stdout = stdout;
        rec.updated_at = new Date().toISOString();
        this.executions.set(executionId, rec);
      }
      this.events.emit(`exec:output:${executionId}`);
    });
  if (opts.captureStderr && child.stderr) child.stderr.on('data', (d) => {
      addChunk('err', d);
      const rec = this.executions.get(executionId);
      if (rec) {
        rec.stderr = stderr;
        rec.updated_at = new Date().toISOString();
        this.executions.set(executionId, rec);
      }
      this.events.emit(`exec:output:${executionId}`);
    });

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

  child.on('error', () => {
      finalize('failed');
      this.processes.delete(executionId);
      this.events.emit(`exec:exit:${executionId}`);
    });
  child.on('exit', (code) => {
      finalize(killedByTimeout ? 'failed' : (code === 0 ? 'completed' : 'failed'), code === null ? undefined : code);
      this.processes.delete(executionId);
      this.events.emit(`exec:exit:${executionId}`);
    });
  }
}

// Optional autostart when EXECUTOR_AUTOSTART=true (for local dev only)
if (process.env['EXECUTOR_AUTOSTART'] === 'true') {
  const srv = new ExecutorServer();
  void srv.start();
}
