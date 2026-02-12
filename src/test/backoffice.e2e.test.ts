import { describe, test, expect } from 'vitest';
import http from 'http';
import { BackofficeServer } from '../backoffice/server.js';
import { ProcessManager } from '../core/process-manager.js';
import { TerminalManager } from '../core/terminal-manager.js';
import { FileManager } from '../core/file-manager.js';
import { CommandHistoryManager } from '../core/enhanced-history-manager.js';
import { ConfigManager } from '../core/config-manager.js';

function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on('error', reject);
  });
}

async function getWithRetry(url: string, attempts = 3): Promise<{ status: number; body: string }> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await get(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError;
}

describe('BackofficeServer E2E', () => {
  test('should start and respond to /health', async () => {
    const fileManager = new FileManager();
    const cfg = new ConfigManager();
    const hist = new CommandHistoryManager(cfg.getEnhancedSecurityConfig());
    const pm = new ProcessManager(5, '/tmp/mcp-shell-outputs-test', fileManager);
    const tm = new TerminalManager();
    pm.setTerminalManager(tm);

    // Bind to random available port by temporarily overriding env
    const server = new BackofficeServer({ processManager: pm, terminalManager: tm, fileManager, historyManager: hist }, 0);
    await server.start();
    const port = server.getListenPort();

    const res = await get(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.status).toBe('ok');
    expect(json.service).toBe('backoffice');

    await server.stop();
  });

  test('should respond to /api/dashboard with basic structure', async () => {
    const fileManager = new FileManager();
    const cfg = new ConfigManager();
    const hist = new CommandHistoryManager(cfg.getEnhancedSecurityConfig());
    const pm = new ProcessManager(5, '/tmp/mcp-shell-outputs-test', fileManager);
    const tm = new TerminalManager();
    pm.setTerminalManager(tm);

    const server = new BackofficeServer({ processManager: pm, terminalManager: tm, fileManager, historyManager: hist }, 0);
    await server.start();
    const port = server.getListenPort();

    const res = await getWithRetry(`http://127.0.0.1:${port}/api/dashboard`);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(typeof json.timestamp).toBe('string');
    expect(json).toHaveProperty('history');
    expect(json).toHaveProperty('executions');
    expect(json).toHaveProperty('terminals');
    expect(json).toHaveProperty('files');
    // Minimal shape checks
    expect(typeof json.history.total_entries).toBe('number');
    expect(Array.isArray(json.history.last_5)).toBe(true);
    expect(typeof json.executions.running_count).toBe('number');
    expect(Array.isArray(json.executions.running_output_tails)).toBe(true);

    await server.stop();
  });
});
