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

        if (req.method !== 'GET') {
          this.json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET only' } });
          return;
        }

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
              if (parts.length === 2) {
                await this.handleTerminalsList(res, searchParams);
                return;
              }
              const id = parts[2];
              if (!id) {
                this.json(res, 400, { error: { code: 'BAD_REQUEST', message: 'Missing terminal id' } });
                return;
              }
              if (parts[3] === 'output') {
                await this.handleTerminalOutput(res, id, searchParams);
                return;
              }
              await this.handleTerminalGet(res, id);
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
