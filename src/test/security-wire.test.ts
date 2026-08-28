import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function inheritedEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

async function connectRestrictiveClient(
  workspaceRoot: string,
  providerPath: string
): Promise<{ client: Client; transport: StdioClientTransport }> {
  const environment = inheritedEnvironment();
  delete environment['MCP_SHELL_ENHANCED_MODE'];
  delete environment['MCP_SHELL_LLM_EVALUATION'];
  environment['MCP_SHELL_SECURITY_MODE'] = 'restrictive';
  environment['MCP_SHELL_ALLOWED_WORKDIRS'] = workspaceRoot;
  environment['MCP_SHELL_DEFAULT_WORKDIR'] = workspaceRoot;
  environment['MCP_SHELL_BWRAP_PATH'] = providerPath;
  environment['MCP_SHELL_ENABLE_STREAMING'] = 'false';

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/index.ts'],
    cwd: process.cwd(),
    env: environment,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'restrictive-wire-test', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
}

describe.runIf(process.platform === 'linux')('restrictive MCP wire contract', () => {
  it('preserves stable sandbox error codes and exposes no runtime downgrade tool', async () => {
    const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-shell-wire-error-'));
    const { client } = await connectRestrictiveClient(
      workspaceRoot,
      path.join(workspaceRoot, 'missing-bwrap')
    );

    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).not.toContain('security_set_restrictions');

      const result = await client.callTool({
        name: 'shell_execute',
        arguments: { command: 'printf never', execution_mode: 'foreground' },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        code: 'SANDBOX_UNAVAILABLE',
        category: 'SECURITY',
      });
    } finally {
      await client.close();
      await fsp.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it.runIf(fs.existsSync('/usr/bin/bwrap'))(
    'runs the documented restrictive startup without client sampling support',
    async () => {
      const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-shell-wire-pass-'));
      const { client } = await connectRestrictiveClient(workspaceRoot, '/usr/bin/bwrap');

      try {
        const called = await client.callTool({
          name: 'shell_execute',
          arguments: { command: 'printf wire-smoke', execution_mode: 'foreground' },
        });
        const textContent = called.content.find((item) => item.type === 'text');
        expect(textContent?.type).toBe('text');
        if (!textContent || textContent.type !== 'text') {
          throw new Error('The restrictive wire response did not contain text.');
        }
        const response = JSON.parse(textContent.text) as Record<string, unknown>;
        expect(response['stdout']).toBe('wire-smoke');
        expect(response['execution_isolation']).toMatchObject({
          kind: 'sandbox',
          launcher: 'bwrap',
          profile: 'restrictive-v1',
        });
      } finally {
        await client.close();
        await fsp.rm(workspaceRoot, { recursive: true, force: true });
      }
    }
  );

  it.runIf(fs.existsSync('/usr/bin/bwrap'))(
    'retains adaptive output produced after the foreground transition',
    async () => {
      const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-shell-wire-adaptive-'));
      const { client } = await connectRestrictiveClient(workspaceRoot, '/usr/bin/bwrap');

      try {
        const started = await client.callTool({
          name: 'shell_execute',
          arguments: {
            command: 'printf before; sleep 2; printf after',
            execution_mode: 'adaptive',
            foreground_timeout_seconds: 1,
            timeout_seconds: 5,
            max_output_size: 1024,
          },
        });
        const startedText = started.content.find((item) => item.type === 'text');
        if (!startedText || startedText.type !== 'text') {
          throw new Error('The adaptive start response did not contain text.');
        }
        const startedExecution = JSON.parse(startedText.text) as Record<string, unknown>;
        expect(startedExecution['status']).toBe('running');
        const executionId = startedExecution['execution_id'];
        const initialOutputId = startedExecution['output_id'];
        expect(typeof executionId).toBe('string');
        expect(typeof initialOutputId).toBe('string');

        let completedExecution: Record<string, unknown> = startedExecution;
        for (let attempt = 0; attempt < 100 && completedExecution['status'] === 'running'; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 30));
          const polled = await client.callTool({
            name: 'process_get_execution',
            arguments: { execution_id: executionId },
          });
          const polledText = polled.content.find((item) => item.type === 'text');
          if (!polledText || polledText.type !== 'text') {
            throw new Error('The adaptive poll response did not contain text.');
          }
          completedExecution = JSON.parse(polledText.text) as Record<string, unknown>;
        }

        expect(completedExecution['status']).toBe('completed');
        expect(completedExecution['stdout']).toBe('beforeafter');
        expect(completedExecution['output_truncated']).toBe(false);
        expect(completedExecution['output_status']).toMatchObject({ complete: true });
        expect(completedExecution['output_id']).toBe(initialOutputId);

        const retained = await client.callTool({
          name: 'read_execution_output',
          arguments: { output_id: initialOutputId },
        });
        const retainedText = retained.content.find((item) => item.type === 'text');
        if (!retainedText || retainedText.type !== 'text') {
          throw new Error('The retained adaptive output response did not contain text.');
        }
        const retainedOutput = JSON.parse(retainedText.text) as Record<string, unknown>;
        expect(retainedOutput['content']).toBe('beforeafter');
      } finally {
        await client.close();
        await fsp.rm(workspaceRoot, { recursive: true, force: true });
      }
    }
  );
});
