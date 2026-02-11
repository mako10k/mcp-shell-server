import http, { ServerResponse } from 'http';
import { URL } from 'url';
import path from 'path';
import fs from 'fs/promises';
import { ProcessManager } from '../core/process-manager.js';
import { TerminalManager } from '../core/terminal-manager.js';
import { FileManager } from '../core/file-manager.js';
import { CommandHistoryManager } from '../core/enhanced-history-manager.js';
import { logger } from '../utils/helpers.js';
import { listenServer, closeServer } from '../utils/server-helpers.js';
import { RemoteProcessService } from '../core/remote-process-service.js';
import { startHeartbeat } from '../utils/sse.js';

interface BackofficeDeps {
  processManager: ProcessManager;
  terminalManager: TerminalManager;
  fileManager: FileManager;
  historyManager: CommandHistoryManager;
}

export class BackofficeServer {
  private server: http.Server | null = null;
  private readonly host = '127.0.0.1';
  private readonly port: number;

  constructor(private deps: BackofficeDeps, port?: number) {
    this.port = port || Number(process.env['BACKOFFICE_PORT'] || 3030);
  }

  start(): Promise<void> {
    if (this.server) return Promise.resolve();

    this.server = http.createServer(async (req, res) => {
        try {
        // Localhost only
        const remote = req.socket.remoteAddress || '';
        if (!this.isLocalAddress(remote)) {
          this.json(res, 403, { error: { code: 'FORBIDDEN', message: 'Localhost only' } });
          return;
        }

        // Basic routing
        if (!req.url) {
          this.json(res, 400, { error: { code: 'BAD_REQUEST', message: 'No URL' } });
          return;
        }

        const url = new URL(req.url, `http://${this.host}:${this.port}`);
        const { pathname, searchParams } = url;

        // Health endpoint for diagnostics
        if (pathname === '/health') {
          this.json(res, 200, { status: 'ok', service: 'backoffice', port: this.getListenPort() });
          return;
        }

        // Dashboard snapshot API
        if (pathname === '/api/dashboard') {
          if (req.method !== 'GET') {
            this.json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET only' } });
            return;
          }
          await this.handleDashboard(res);
          return;
        }

  // Note: Most endpoints are GET-only, except remote kill proxy which is POST

        if (pathname === '/' || pathname === '/index.html') {
          await this.serveStatic(res, 'index.html', 'text/html; charset=utf-8');
          return;
        }
        if (pathname === '/main.js') {
          await this.serveStatic(res, 'main.js', 'application/javascript; charset=utf-8');
          return;
        }
        if (pathname === '/styles.css') {
          await this.serveStatic(res, 'styles.css', 'text/css; charset=utf-8');
          return;
        }

        // APIs
        if (pathname.startsWith('/api/')) {
          const parts = pathname.split('/').filter(Boolean); // e.g. ['api','executions','<id>','outputs']
          const scope = parts[1];
          switch (scope) {
            case 'history': {
              if (req.method !== 'GET') {
                this.json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET only' } });
                return;
              }
              if (parts.length === 2) {
                await this.handleHistoryList(res, searchParams);
                return;
              }
              const id = parts[2];
              if (!id) {
                this.json(res, 400, { error: { code: 'BAD_REQUEST', message: 'Missing history id' } });
                return;
              }
              await this.handleHistoryGet(res, id);
              return;
            }
            case 'executions': {
              if (req.method !== 'GET') {
                this.json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET only' } });
                return;
              }
              if (parts.length === 2) {
                await this.handleExecutionsList(res, searchParams);
                return;
              }
              const id = parts[2];
              if (!id) {
                this.json(res, 400, { error: { code: 'BAD_REQUEST', message: 'Missing execution id' } });
                return;
              }
              if (parts[3] === 'outputs') {
                await this.handleExecutionOutputs(res, id);
                return;
              }
              await this.handleExecutionGet(res, id);
              return;
            }
            case 'terminals': {
              // GET only for terminals APIs (including SSE)
              if (req.method !== 'GET') {
                this.json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET only' } });
                return;
              }
              if (parts.length === 2) {
                await this.handleTerminalsList(res, searchParams);
                return;
              }
              const id = parts[2];
              if (!id) {
                this.json(res, 400, { error: { code: 'BAD_REQUEST', message: 'Missing terminal id' } });
                return;
              }
              if (parts[3] === 'sse') {
                await this.handleTerminalSSE(res, id, searchParams, req);
                return;
              }
              if (parts[3] === 'output') {
                await this.handleTerminalOutput(res, id, searchParams);
                return;
              }
              await this.handleTerminalGet(res, id);
              return;
            }
            case 'remote-exec': {
              // Proxy to external executor backend when EXECUTION_BACKEND=remote
              if (parts.length < 3) {
                this.json(res, 400, { error: { code: 'BAD_REQUEST', message: 'Missing execution id' } });
                return;
              }
              const id = parts[2] || '';
              const action = parts[3] || '';
              if (action === 'kill') {
                if (req.method !== 'POST') {
                  this.json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } });
                  return;
                }
                await this.handleRemoteExecKill(res, id, searchParams);
                return;
              }
              // GET /api/remote-exec/:id and /api/remote-exec/:id/outputs
              if (req.method !== 'GET') {
                this.json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET only' } });
                return;
              }
              if (action === 'sse') {
                await this.handleRemoteExecSSE(res, id, req);
                return;
              }
              if (action === 'outputs') {
                await this.handleRemoteExecOutputs(res, id);
                return;
              }
              await this.handleRemoteExecGet(res, id);
              return;
            }
            default:
              break; // fallthrough to 404
          }
        }

        this.json(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
      } catch (err) {
        logger.error('Backoffice request error', { error: String(err) }, 'backoffice');
        this.json(res, 500, { error: { code: 'INTERNAL', message: 'Internal error' } });
      }
    });

    return listenServer(this.server as http.Server, this.host, this.port)
      .then(() => {
        logger.info('Backoffice server started', { host: this.host, port: this.port }, 'backoffice');
      })
      .catch((e) => {
        logger.error('Backoffice server listen error', { error: String(e) }, 'backoffice');
        throw e;
      });
  }

  async stop(): Promise<void> {
  const srv = this.server;
  if (!srv) return;
  await closeServer(srv);
    logger.info('Backoffice server stopped', {}, 'backoffice');
    this.server = null;
  }

  // Expose current listening port (useful when binding with port 0 in tests)
  getListenPort(): number {
    const srv = this.server as http.Server | null;
    if (!srv) return this.port;
    const addr = srv.address();
    if (typeof addr === 'object' && addr && typeof addr.port === 'number') return addr.port;
    return this.port;
  }

  // ---------- Handlers ----------
  private async handleHistoryList(res: ServerResponse, q: URLSearchParams) {
    const page = Math.max(1, parseInt(q.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(q.get('page_size') || '20', 10)));
    const offset = (page - 1) * pageSize;
    const query: Record<string, unknown> = { limit: pageSize + offset };

    const search = q.get('q');
    const wd = q.get('wd');
    const executed = q.get('executed');
    const safety = q.get('safety');
    const dateFrom = q.get('date_from');
    const dateTo = q.get('date_to');

    if (search) query['command'] = search;
    if (wd) query['working_directory'] = wd;
    if (executed !== null) query['was_executed'] = executed === 'true';
    if (safety) query['safety_classification'] = safety;

    let results = this.deps.historyManager.searchHistory(query);
    if (dateFrom || dateTo) {
      const from = dateFrom ? new Date(dateFrom) : new Date(0);
      const to = dateTo ? new Date(dateTo) : new Date();
      results = results.filter((e) => new Date(e.timestamp) >= from && new Date(e.timestamp) <= to);
    }

    const totalEntries = results.length;
    const entries = results.slice(offset, offset + pageSize).map((e) => ({
      execution_id: e.execution_id,
      command: e.command,
      timestamp: e.timestamp,
      working_directory: e.working_directory,
      safety_classification: e.safety_classification,
      was_executed: e.was_executed,
      execution_status: e.execution_status,
      output_summary: e.output_summary,
    }));

    this.json(res, 200, {
      entries,
      pagination: {
        page,
        page_size: pageSize,
        total_entries: totalEntries,
        total_pages: Math.ceil(totalEntries / pageSize),
        has_next: offset + pageSize < totalEntries,
        has_previous: page > 1,
      },
    });
  }

  private async handleHistoryGet(res: ServerResponse, id: string) {
    const results = this.deps.historyManager.searchHistory({ limit: 1000 });
    const entry = results.find((e) => e.execution_id === id);
    if (!entry) {
      this.json(res, 404, { error: { code: 'NOT_FOUND', message: 'Entry not found' } });
      return;
    }
    this.json(res, 200, { entry });
  }

  private async handleExecutionsList(res: ServerResponse, q: URLSearchParams) {
    const limit = Math.min(100, Math.max(1, parseInt(q.get('limit') || '20', 10)));
    const status = q.get('status') as 'running' | 'completed' | 'failed' | 'timeout' | 'all' | null;
    const cmd = q.get('q') || undefined;

    const options: { status?: 'running' | 'completed' | 'failed' | 'timeout'; commandPattern?: string; limit: number } = { limit };
    if (status && status !== 'all') options.status = status;
    if (cmd) options.commandPattern = cmd;

    const result = this.deps.processManager.listExecutions(options);
    this.json(res, 200, {
      processes: result.executions,
      total_count: result.total,
      filtered_count: result.executions.length,
    });
  }

  private async handleExecutionGet(res: ServerResponse, id: string) {
    const exec = this.deps.processManager.getExecution(id);
    if (!exec) {
      this.json(res, 404, { error: { code: 'NOT_FOUND', message: 'Execution not found' } });
      return;
    }
    this.json(res, 200, exec);
  }

  private async handleExecutionOutputs(res: ServerResponse, id: string) {
    try {
      const result = this.deps.fileManager.listFiles({ executionId: id });
      this.json(res, 200, result);
    } catch (e) {
      this.json(res, 500, { error: { code: 'INTERNAL', message: String(e) } });
    }
  }

  private async handleTerminalsList(res: ServerResponse, q: URLSearchParams) {
    const limit = Math.min(200, Math.max(1, parseInt(q.get('limit') || '50', 10)));
    const status = (q.get('status') as 'active' | 'idle' | 'closed' | 'all' | null) || 'all';
    const pattern = q.get('session_name_pattern');
    const listOptions: { limit?: number; statusFilter?: 'active' | 'idle' | 'closed' | 'all'; sessionNamePattern?: string } = {};
    listOptions.limit = limit;
    listOptions.statusFilter = status;
    if (pattern !== null) listOptions.sessionNamePattern = pattern;
    const result = this.deps.terminalManager.listTerminals(listOptions);
    this.json(res, 200, result);
  }

  private async handleTerminalGet(res: ServerResponse, id: string) {
    try {
      const info = await this.deps.terminalManager.getTerminal(id, false);
      this.json(res, 200, info);
    } catch (e) {
      this.json(res, 404, { error: { code: 'NOT_FOUND', message: 'Terminal not found' } });
    }
  }

  private async handleTerminalOutput(res: ServerResponse, id: string, q: URLSearchParams) {
    try {
      const start = q.get('start_line');
      const lineCount = q.get('line_count');
      const includeAnsi = (q.get('include_ansi') || 'false') === 'true';
      const includeFg = (q.get('include_foreground_process') || 'false') === 'true';
      const result = await this.deps.terminalManager.getOutput(
        id,
        start ? parseInt(start, 10) : undefined,
        lineCount ? parseInt(lineCount, 10) : 200,
        includeAnsi,
        includeFg
      );
      this.json(res, 200, result);
    } catch (e) {
      this.json(res, 404, { error: { code: 'NOT_FOUND', message: 'Terminal not found' } });
    }
  }

  // ---------- Remote Executor Proxies ----------
  private isRemoteBackend(): boolean {
    return (process.env['EXECUTION_BACKEND'] || '').toLowerCase() === 'remote';
  }

  private getRemoteService(): RemoteProcessService {
    return new RemoteProcessService();
  }

  private ensureRemoteBackend(res: ServerResponse): boolean {
    if (!this.isRemoteBackend()) {
      this.json(res, 400, { error: { code: 'BAD_REQUEST', message: 'Remote backend not enabled' } });
      return false;
    }
    return true;
  }

  private async handleRemoteRequest<T>(
    res: ServerResponse,
    action: (remote: RemoteProcessService) => Promise<T>
  ): Promise<void> {
    if (!this.ensureRemoteBackend(res)) return;
    try {
      const remote = this.getRemoteService();
      const data = await action(remote);
      this.json(res, 200, data);
    } catch (e) {
      this.json(res, 502, { error: { code: 'BAD_GATEWAY', message: String(e) } });
    }
  }

  // ---------- Dashboard Handler ----------
  private async handleDashboard(res: ServerResponse) {
    try {
      // History summary
  const history = this.deps.historyManager.searchHistory({ limit: 200 });
  const totalHistory = history.length;
  const withEval = history.filter((h) => Boolean(h.safety_classification) || Boolean(h.llm_evaluation_result)).length;
  const executedTrue = history.filter((h) => h.was_executed === true).length;

      // Process stats
      const runningExec = this.deps.processManager.listExecutions({ status: 'running', limit: 50 }).executions;
      const recentExec = this.deps.processManager.listExecutions({ limit: 20 }).executions
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      // Terminals
      const terms = this.deps.terminalManager.listTerminals({ limit: 100 });

      // File/output stats (sizes)
      const fileStats = this.deps.fileManager.getUsageStats();

      // Latest outputs summary for currently running commands (tail)
      const recentRunningSummaries = await Promise.all(runningExec.slice(0, 10).map(async (e) => {
        const summary: { execution_id: string; command: string; status: string; output_tail?: string } = {
          execution_id: e.execution_id,
          command: e.command,
          status: e.status,
        };
        const outId = e.output_id;
        if (outId) {
          try {
            const read = await this.deps.fileManager.readFile(outId, Math.max(0, (await (async () => {
              const info = this.deps.fileManager.getFile(outId);
              return Math.max(0, info.size - 4096);
            })())), 4096);
            summary.output_tail = read.content;
          } catch {}
        }
        return summary;
      }));

      this.json(res, 200, {
        timestamp: new Date().toISOString(),
        history: {
          total_entries: totalHistory,
          with_evaluation: withEval,
          executed_true: executedTrue,
          last_5: history.slice(0, 5),
        },
        executions: {
          running_count: runningExec.length,
          running: runningExec,
          recent: recentExec.slice(0, 10),
          running_output_tails: recentRunningSummaries,
        },
        terminals: terms,
        files: fileStats,
      });
    } catch (e) {
      this.json(res, 500, { error: { code: 'INTERNAL', message: String(e) } });
    }
  }

  private async handleRemoteExecGet(res: ServerResponse, id: string) {
    await this.handleRemoteRequest(res, (remote) => remote.get(id));
  }

  private async handleRemoteExecOutputs(res: ServerResponse, id: string) {
    await this.handleRemoteRequest(res, (remote) => remote.outputs(id));
  }

  private async handleRemoteExecKill(res: ServerResponse, id: string, q: URLSearchParams) {
    if (!this.ensureRemoteBackend(res)) return;
    try {
      const remote = this.getRemoteService();
      const force = (q.get('force') || 'false') === 'true';
      const sig = q.get('signal');
      const req: import('../core/remote-process-service.js').RemoteKillRequest = { };
      if (force) (req as Record<string, unknown>)['force'] = true;
      if (sig) (req as Record<string, unknown>)['signal'] = sig;
      const data = await remote.kill(id, req);
      this.json(res, 200, data);
    } catch (e) {
      this.json(res, 502, { error: { code: 'BAD_GATEWAY', message: String(e) } });
    }
  }

  // ---------- SSE Handlers ----------
  private initSSE(res: ServerResponse) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
  }

  private writeSSE(res: ServerResponse, event: string, data: unknown) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    res.write(`event: ${event}\n`);
    // split by newlines to follow SSE spec
    const lines = String(payload).split(/\r?\n/);
    for (const line of lines) {
      res.write(`data: ${line}\n`);
    }
    res.write('\n');
  }

  private async handleTerminalSSE(res: ServerResponse, id: string, q: URLSearchParams, req: http.IncomingMessage) {
    this.initSSE(res);
    let lastStart: number | undefined = undefined;
    const lc = q.get('line_count');
    const lineCount = lc ? parseInt(lc, 10) : 200;
    const includeAnsi = (q.get('include_ansi') || 'false') === 'true';
    const includeFg = (q.get('include_foreground_process') || 'false') === 'true';

    // 初回スナップショットを送信
    try {
      const out = await this.deps.terminalManager.getOutput(
        id,
        lastStart,
        lineCount,
        includeAnsi,
        includeFg
      );
      this.writeSSE(res, 'terminal_output', out);
      lastStart = out.next_start_line;
    } catch (e) {
      this.writeSSE(res, 'error', { message: 'Terminal not found', id });
      res.end();
      return;
    }

    // TerminalManager のイベントに連結（イベント駆動）
    // 端末出力の変化があれば push
  const ev = this.deps.terminalManager.getEventEmitter();
    let heartbeat: NodeJS.Timeout | null = null;

    const pushLatest = async () => {
      try {
        const out = await this.deps.terminalManager.getOutput(
          id,
          lastStart,
          lineCount,
          includeAnsi,
          includeFg
        );
        // 変化が無い場合は送らない（心拍は別で送る）
        if (out.line_count > 0) {
          this.writeSSE(res, 'terminal_output', out);
          lastStart = out.next_start_line;
        }
      } catch (e) {
        this.writeSSE(res, 'error', { message: 'Terminal not found', id });
        cleanup();
        res.end();
      }
    };

    const onData = () => { void pushLatest(); };
    const onExit = () => {
      // 最後のスナップショット送信（可能なら）
      void pushLatest().finally(() => {
        this.writeSSE(res, 'end', { reason: 'terminal_closed' });
        cleanup();
        res.end();
      });
    };

    const cleanup = () => {
      if (ev) {
        ev.removeListener(`terminal:output:${id}`, onData);
        ev.removeListener(`terminal:exit:${id}`, onExit);
      }
      if (heartbeat) clearInterval(heartbeat);
    };

    if (ev) {
      ev.on(`terminal:output:${id}`, onData);
      ev.on(`terminal:exit:${id}`, onExit);
    }

    // アイドル時はハートビート（10秒間隔）
    heartbeat = startHeartbeat((event, data) => this.writeSSE(res, event, data));

    req.on('close', cleanup);
    req.on('aborted', cleanup);
  }

  private async handleRemoteExecSSE(res: ServerResponse, id: string, req: http.IncomingMessage) {
    if (!this.ensureRemoteBackend(res)) return;
    this.initSSE(res);
    // Executor の SSE をそのままプロキシする（イベント駆動）
    const baseUrl = (process.env['EXECUTOR_URL'] || `http://${process.env['EXECUTOR_HOST'] || '127.0.0.1'}:${process.env['EXECUTOR_PORT'] || '4030'}`).replace(/\/$/, '');
    const url = `${baseUrl}/v1/exec/${encodeURIComponent(id)}/sse`;
    const token = process.env['EXECUTOR_TOKEN'];
    const controller = new AbortController();

    try {
      const init: RequestInit = { method: 'GET', signal: controller.signal };
      if (token) {
        init.headers = { Authorization: `Bearer ${token}` } as Record<string, string>;
      }
      const resp = await fetch(url, init);
      if (!resp.ok || !resp.body) {
        this.writeSSE(res, 'error', { message: `Upstream error HTTP ${resp.status}` });
        res.end();
        return;
      }

      // Web ReadableStream を逐次読み取りして下流に書き出す
      const reader = (resp.body as ReadableStream<Uint8Array>).getReader();
      let closed = false;
      const pump = async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value && value.byteLength > 0) {
              res.write(Buffer.from(value));
            }
          }
        } catch (e) {
          // 接続中断などは黙殺して終了
        } finally {
          if (!closed) {
            closed = true;
            res.end();
          }
        }
      };
      void pump();

      const clean = () => {
        if (!closed) {
          closed = true;
          try { controller.abort(); } catch {}
          try { res.end(); } catch {}
        }
      };
      req.on('close', clean);
      req.on('aborted', clean);
    } catch (e) {
      this.writeSSE(res, 'error', { message: String(e) });
      res.end();
    }
  }

  // ---------- Utils ----------
  private async serveStatic(res: ServerResponse, file: string, contentType: string) {
    try {
      const staticDir = path.resolve(process.cwd(), 'public');
      const content = await fs.readFile(path.join(staticDir, file));
      res.statusCode = 200;
      res.setHeader('Content-Type', contentType);
      res.end(content);
    } catch (e) {
      this.json(res, 404, { error: { code: 'NOT_FOUND', message: 'File not found' } });
    }
  }

  private json(res: ServerResponse, status: number, obj: unknown) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
  }

  private isLocalAddress(addr: string): boolean {
    // Normalize IPv6-mapped IPv4
    if (addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1') return true;
    // Some environments return undefined/empty during tests
    if (!addr) return true;
    return false;
  }
}
