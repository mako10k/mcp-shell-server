import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FileManager } from '../core/file-manager.js';
import { ProcessManager } from '../core/process-manager.js';
import { createShellToolRuntime } from '../runtime/tool-runtime.js';
import { BwrapLauncher } from '../security/bwrap-launcher.js';
import { SecurityManager } from '../security/manager.js';
import { isValidPath } from '../utils/helpers.js';

const savedEnvironment = {
  securityMode: process.env['MCP_SHELL_SECURITY_MODE'],
  allowedWorkdirs: process.env['MCP_SHELL_ALLOWED_WORKDIRS'],
  defaultWorkdir: process.env['MCP_SHELL_DEFAULT_WORKDIR'],
  bwrapPath: process.env['MCP_SHELL_BWRAP_PATH'],
  streaming: process.env['MCP_SHELL_ENABLE_STREAMING'],
  executionBackend: process.env['EXECUTION_BACKEND'],
  enhancedMode: process.env['MCP_SHELL_ENHANCED_MODE'],
  llmEvaluation: process.env['MCP_SHELL_LLM_EVALUATION'],
  hostSentinel: process.env['MCP_SHELL_TEST_HOST_SENTINEL'],
};

afterEach(() => {
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  restore('MCP_SHELL_SECURITY_MODE', savedEnvironment.securityMode);
  restore('MCP_SHELL_ALLOWED_WORKDIRS', savedEnvironment.allowedWorkdirs);
  restore('MCP_SHELL_DEFAULT_WORKDIR', savedEnvironment.defaultWorkdir);
  restore('MCP_SHELL_BWRAP_PATH', savedEnvironment.bwrapPath);
  restore('MCP_SHELL_ENABLE_STREAMING', savedEnvironment.streaming);
  restore('EXECUTION_BACKEND', savedEnvironment.executionBackend);
  restore('MCP_SHELL_ENHANCED_MODE', savedEnvironment.enhancedMode);
  restore('MCP_SHELL_LLM_EVALUATION', savedEnvironment.llmEvaluation);
  restore('MCP_SHELL_TEST_HOST_SENTINEL', savedEnvironment.hostSentinel);
});

describe('Issue #24 execution boundary', () => {
  it('uses canonical component boundaries and rejects symlink escape', async () => {
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-shell-path-'));
    const root = path.join(base, 'root');
    const sibling = path.join(base, 'root-sibling');
    const outside = path.join(base, 'outside');
    await Promise.all([
      fsp.mkdir(root),
      fsp.mkdir(sibling),
      fsp.mkdir(outside),
    ]);
    const insideFile = path.join(root, 'inside.txt');
    const siblingFile = path.join(sibling, 'sibling.txt');
    const outsideFile = path.join(outside, 'outside.txt');
    await Promise.all([
      fsp.writeFile(insideFile, 'inside'),
      fsp.writeFile(siblingFile, 'sibling'),
      fsp.writeFile(outsideFile, 'outside'),
    ]);
    const escapeLink = path.join(root, 'escape.txt');
    await fsp.symlink(outsideFile, escapeLink);

    expect(isValidPath(insideFile, [root])).toBe(true);
    expect(isValidPath(siblingFile, [root])).toBe(false);
    expect(isValidPath(escapeLink, [root])).toBe(false);
    expect(isValidPath(path.join(root, 'missing.txt'), [root])).toBe(false);
    await fsp.rm(base, { recursive: true, force: true });
  });

  it('maps restrictive to sandbox and fails closed on unsupported routes', () => {
    const manager = new SecurityManager();
    manager.setRestrictions({ security_mode: 'restrictive' });

    expect(
      manager.resolveExecutionBoundary({
        remote: false,
        executionMode: 'foreground',
        createTerminal: false,
        hasEnvironmentOverrides: false,
      })
    ).toEqual({ kind: 'sandbox', profile: 'restrictive-v1' });

    const cases = [
      {
        route: {
          remote: true,
          executionMode: 'foreground' as const,
          createTerminal: false,
          hasEnvironmentOverrides: false,
        },
        code: 'SANDBOX_REMOTE_UNAVAILABLE',
      },
      {
        route: {
          remote: false,
          executionMode: 'foreground' as const,
          createTerminal: true,
          hasEnvironmentOverrides: false,
        },
        code: 'SANDBOX_TERMINAL_UNAVAILABLE',
      },
      {
        route: {
          remote: false,
          executionMode: 'detached' as const,
          createTerminal: false,
          hasEnvironmentOverrides: false,
        },
        code: 'SANDBOX_DETACHED_UNAVAILABLE',
      },
      {
        route: {
          remote: false,
          executionMode: 'foreground' as const,
          createTerminal: false,
          hasEnvironmentOverrides: true,
        },
        code: 'SANDBOX_ENV_UNSUPPORTED',
      },
    ];

    for (const testCase of cases) {
      expect(() => manager.resolveExecutionBoundary(testCase.route)).toThrowError(
        expect.objectContaining({ code: testCase.code })
      );
    }
  });

  it('rejects an invalid security-mode configuration instead of selecting host execution', () => {
    process.env['MCP_SHELL_SECURITY_MODE'] = 'unsupported-mode';
    expect(() => new SecurityManager()).toThrowError(
      expect.objectContaining({ code: 'SECURITY_CONFIGURATION_INVALID' })
    );
  });

  it('fails closed when the configured Bubblewrap provider is missing', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-shell-bwrap-missing-'));
    const outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-shell-bwrap-missing-output-'));
    process.env['MCP_SHELL_ALLOWED_WORKDIRS'] = root;
    process.env['MCP_SHELL_DEFAULT_WORKDIR'] = root;
    process.env['MCP_SHELL_ENABLE_STREAMING'] = 'false';
    const launcher = new BwrapLauncher([root], {
      providerPath: path.join(root, 'missing-bwrap'),
    });
    expect(() => launcher.buildLaunchSpec('echo never', root)).toThrowError(
      expect.objectContaining({ code: 'SANDBOX_UNAVAILABLE' })
    );
    const manager = new ProcessManager(5, outputDir, undefined, launcher);
    const sideEffect = path.join(root, 'provider-failure-must-not-run');
    await expect(
      manager.executeCommand({
        command: `touch ${JSON.stringify(sideEffect)}`,
        executionMode: 'foreground',
        executionBoundary: { kind: 'sandbox', profile: 'restrictive-v1' },
        workingDirectory: root,
        timeoutSeconds: 5,
        maxOutputSize: 1024,
        captureStderr: true,
      })
    ).rejects.toMatchObject({ code: 'SANDBOX_UNAVAILABLE' });
    expect(fs.existsSync(sideEffect)).toBe(false);
    manager.cleanup();
    await Promise.all([
      fsp.rm(root, { recursive: true, force: true }),
      fsp.rm(outputDir, { recursive: true, force: true }),
    ]);
  });

  it('rejects a Bubblewrap provider resolved inside the approved workspace', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-shell-bwrap-workspace-'));
    const providerPath = path.join(root, 'bwrap');
    await fsp.writeFile(providerPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const launcher = new BwrapLauncher([root], { providerPath });

    expect(() => launcher.buildLaunchSpec('echo never', root)).toThrowError(
      expect.objectContaining({ code: 'SANDBOX_CAPABILITY_MISSING' })
    );
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('fails closed in ShellTools before unsupported restrictive routes start', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-shell-route-'));
    const outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-shell-route-output-'));
    process.env['MCP_SHELL_SECURITY_MODE'] = 'permissive';
    process.env['MCP_SHELL_ALLOWED_WORKDIRS'] = root;
    process.env['MCP_SHELL_DEFAULT_WORKDIR'] = root;
    process.env['MCP_SHELL_ENABLE_STREAMING'] = 'false';
    process.env['MCP_SHELL_ENHANCED_MODE'] = 'false';
    process.env['MCP_SHELL_LLM_EVALUATION'] = 'false';
    const runtime = createShellToolRuntime({ outputDir });
    await runtime.shellTools.setSecurityRestrictions({ security_mode: 'restrictive' });
    expect(runtime.securityManager.getRestrictions()?.security_mode).toBe('restrictive');

    process.env['EXECUTION_BACKEND'] = 'remote';
    await expect(
      runtime.shellTools.executeShellValidated({
        command: 'echo never',
        execution_mode: 'foreground',
      })
    ).rejects.toMatchObject({ code: 'SANDBOX_REMOTE_UNAVAILABLE' });

    process.env['EXECUTION_BACKEND'] = 'local';
    await expect(
      runtime.shellTools.executeShellValidated({
        command: 'echo never',
        execution_mode: 'detached',
      })
    ).rejects.toMatchObject({ code: 'SANDBOX_DETACHED_UNAVAILABLE' });
    const environmentSideEffect = path.join(root, 'environment-route-must-not-run');
    await expect(
      runtime.shellTools.executeShellValidated({
        command: `touch ${JSON.stringify(environmentSideEffect)}`,
        execution_mode: 'foreground',
        environment_variables: { UNSUPPORTED_OVERRIDE: '1' },
      })
    ).rejects.toMatchObject({ code: 'SANDBOX_ENV_UNSUPPORTED' });
    expect(fs.existsSync(environmentSideEffect)).toBe(false);
    await expect(
      runtime.shellTools.terminalOperateValidated({ command: 'echo never' })
    ).rejects.toMatchObject({ code: 'SANDBOX_TERMINAL_UNAVAILABLE' });
    await expect(
      runtime.shellTools.terminalOperateValidated({
        terminal_id: 'existing-terminal',
        dimensions: { width: 100, height: 40 },
      })
    ).rejects.toMatchObject({ code: 'SANDBOX_TERMINAL_UNAVAILABLE' });

    await runtime.cleanup();
    await Promise.all([
      fsp.rm(root, { recursive: true, force: true }),
      fsp.rm(outputDir, { recursive: true, force: true }),
    ]);
  });

  it('fails legacy custom before process creation', async () => {
    const manager = new SecurityManager();
    manager.setRestrictions({ security_mode: 'custom', allowed_commands: ['echo'] });
    expect(() => manager.validateCommand('echo never')).toThrowError(
      expect.objectContaining({ code: 'CUSTOM_MODE_MIGRATION_REQUIRED' })
    );
  });

  it('rejects low-level execution when no boundary was selected', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-shell-boundary-missing-'));
    const outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-shell-boundary-output-'));
    process.env['MCP_SHELL_ALLOWED_WORKDIRS'] = root;
    process.env['MCP_SHELL_DEFAULT_WORKDIR'] = root;
    process.env['MCP_SHELL_ENABLE_STREAMING'] = 'false';
    const manager = new ProcessManager(5, outputDir);
    const sideEffect = path.join(root, 'must-not-exist');

    await expect(
      manager.executeCommand({
        command: `touch ${JSON.stringify(sideEffect)}`,
        executionMode: 'foreground',
        workingDirectory: root,
        timeoutSeconds: 10,
        maxOutputSize: 1024,
        captureStderr: true,
      })
    ).rejects.toMatchObject({ code: 'ISOLATION_REQUIREMENT_MISSING' });
    expect(fs.existsSync(sideEffect)).toBe(false);

    manager.cleanup();
    await Promise.all([
      fsp.rm(root, { recursive: true, force: true }),
      fsp.rm(outputDir, { recursive: true, force: true }),
    ]);
  });

  it.runIf(process.platform === 'linux' && fs.existsSync('/usr/bin/bwrap'))(
    'confines compound commands in the real Bubblewrap execution path',
    async () => {
      const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-shell-bwrap-real-'));
      const outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-shell-output-'));
      const fileDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-shell-files-'));
      process.env['MCP_SHELL_ALLOWED_WORKDIRS'] = root;
      process.env['MCP_SHELL_DEFAULT_WORKDIR'] = root;
      process.env['MCP_SHELL_ENABLE_STREAMING'] = 'false';
      process.env['MCP_SHELL_TEST_HOST_SENTINEL'] = 'host-secret';
      const fileManager = new FileManager(fileDir);
      const manager = new ProcessManager(5, outputDir, fileManager);
      const completedCallbackIds: string[] = [];
      const timeoutCallbackIds: string[] = [];
      manager.setBackgroundProcessCallbacks({
        onComplete: (executionId) => {
          completedCallbackIds.push(executionId);
        },
        onTimeout: (executionId) => {
          timeoutCallbackIds.push(executionId);
        },
      });

      const result = await manager.executeCommand({
        command: [
          'printf "uid=%s\\n" "$(id -u)"',
          'printf "env=%s|%s|%s|%s|%s\\n" "$PATH" "$HOME" "$TMPDIR" "$LANG" "${MCP_SHELL_TEST_HOST_SENTINEL-unset}"',
          'for fd_number in 3 4 5 6 7 8 9; do test ! -e "/proc/$$/fd/$fd_number" || echo "ambient-fd=$fd_number"; done; echo fds-checked',
          'grep -q "^NoNewPrivs:[[:space:]]*1$" /proc/self/status && echo no-new-privs',
          'touch /workspace/forbidden 2>/dev/null || echo readonly',
          'touch /tmp/private && echo tmp-writable',
          'printf "tmp-size="; df -B1 --output=size /tmp | tail -n1 | tr -d " "',
          'test ! -e /etc/passwd && test ! -e /home && test ! -e /run && test ! -e /var && echo host-paths-hidden',
          'if printf x >/dev/tcp/127.0.0.1/1 2>/dev/null; then echo network-open; else echo network-blocked; fi',
        ].join('; '),
        executionMode: 'foreground',
        executionBoundary: { kind: 'sandbox', profile: 'restrictive-v1' },
        workingDirectory: root,
        timeoutSeconds: 15,
        maxOutputSize: 65536,
        captureStderr: true,
      });

      expect(result.status).toBe('completed');
      expect(result.execution_isolation).toMatchObject({
        kind: 'sandbox',
        launcher: 'bwrap',
        profile: 'restrictive-v1',
        workspace_access: 'read-only',
        network_access: 'none',
      });
      if (result.execution_isolation?.kind !== 'sandbox') {
        throw new Error('The restrictive execution did not return a sandbox receipt.');
      }
      expect(result.execution_isolation.provider_version).toMatch(
        /^bubblewrap \d+\.\d+\.\d+$/
      );
      expect(result.stdout).toContain('uid=65534');
      expect(result.stdout).toContain(
        'env=/usr/bin:/bin|/tmp/home|/tmp|C.UTF-8|unset'
      );
      expect(result.stdout).toContain('fds-checked');
      expect(result.stdout).not.toContain('ambient-fd=');
      expect(result.stdout).toContain('no-new-privs');
      expect(result.stdout).toContain('readonly');
      expect(result.stdout).toContain('tmp-writable');
      expect(result.stdout).toContain('host-paths-hidden');
      expect(result.stdout).toContain('network-blocked');
      expect(result.stdout).not.toContain('network-open');
      const tmpSize = Number(result.stdout?.match(/tmp-size=(\d+)/)?.[1]);
      expect(tmpSize).toBeGreaterThan(0);
      expect(tmpSize).toBeLessThanOrEqual(64 * 1024 * 1024);
      expect(fs.existsSync(path.join(root, 'forbidden'))).toBe(false);

      for (let index = 0; index < 10; index += 1) {
        const quickResult = await manager.executeCommand({
          command: 'printf quick',
          executionMode: 'foreground',
          executionBoundary: { kind: 'sandbox', profile: 'restrictive-v1' },
          workingDirectory: root,
          timeoutSeconds: 5,
          maxOutputSize: 1024,
          captureStderr: true,
        });
        expect(quickResult.status).toBe('completed');
        expect(quickResult.stdout).toBe('quick');
      }

      const adaptiveResult = await manager.executeCommand({
        command: 'printf adaptive',
        executionMode: 'adaptive',
        executionBoundary: { kind: 'sandbox', profile: 'restrictive-v1' },
        workingDirectory: root,
        timeoutSeconds: 5,
        foregroundTimeoutSeconds: 2,
        maxOutputSize: 1024,
        captureStderr: true,
      });
      expect(adaptiveResult.status).toBe('completed');
      expect(adaptiveResult.stdout).toBe('adaptive');
      expect(adaptiveResult.execution_isolation?.kind).toBe('sandbox');

      const backgroundResult = await manager.executeCommand({
        command: 'sleep 0.05; printf background',
        executionMode: 'background',
        executionBoundary: { kind: 'sandbox', profile: 'restrictive-v1' },
        workingDirectory: root,
        timeoutSeconds: 5,
        maxOutputSize: 1024,
        captureStderr: true,
      });
      expect(backgroundResult.execution_isolation?.kind).toBe('sandbox');
      let completedBackground = manager.getExecution(backgroundResult.execution_id);
      for (let attempt = 0; attempt < 100 && completedBackground?.status === 'running'; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        completedBackground = manager.getExecution(backgroundResult.execution_id);
      }
      expect(completedBackground?.status).toBe('completed');
      expect(completedBackground?.execution_isolation?.kind).toBe('sandbox');

      const backgroundTimeout = await manager.executeCommand({
        command: 'sleep 30',
        executionMode: 'background',
        executionBoundary: { kind: 'sandbox', profile: 'restrictive-v1' },
        workingDirectory: root,
        timeoutSeconds: 1,
        maxOutputSize: 1024,
        captureStderr: true,
      });
      let timedOutBackground = manager.getExecution(backgroundTimeout.execution_id);
      for (let attempt = 0; attempt < 150 && timedOutBackground?.status === 'running'; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        timedOutBackground = manager.getExecution(backgroundTimeout.execution_id);
      }
      expect(timedOutBackground?.status).toBe('timeout');
      for (
        let attempt = 0;
        attempt < 50 && !timeoutCallbackIds.includes(backgroundTimeout.execution_id);
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(timeoutCallbackIds).toContain(backgroundTimeout.execution_id);
      expect(completedCallbackIds).not.toContain(backgroundTimeout.execution_id);

      const adaptiveTimeout = await manager.executeCommand({
        command: 'sleep 30',
        executionMode: 'adaptive',
        executionBoundary: { kind: 'sandbox', profile: 'restrictive-v1' },
        workingDirectory: root,
        timeoutSeconds: 1,
        foregroundTimeoutSeconds: 0.05,
        maxOutputSize: 1024,
        captureStderr: true,
      });
      expect(adaptiveTimeout.status).toBe('running');
      let timedOutAdaptive = manager.getExecution(adaptiveTimeout.execution_id);
      for (let attempt = 0; attempt < 150 && timedOutAdaptive?.status === 'running'; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        timedOutAdaptive = manager.getExecution(adaptiveTimeout.execution_id);
      }
      expect(timedOutAdaptive?.status).toBe('timeout');
      expect(completedCallbackIds).not.toContain(adaptiveTimeout.execution_id);

      const pipelineSource = await manager.executeCommand({
        command: 'printf pipeline-data',
        executionMode: 'foreground',
        executionBoundary: { kind: 'sandbox', profile: 'restrictive-v1' },
        workingDirectory: root,
        timeoutSeconds: 5,
        maxOutputSize: 1024,
        captureStderr: true,
      });
      const pipelineOutputId = pipelineSource.output_id;
      expect(pipelineOutputId).toBeDefined();
      if (!pipelineOutputId) {
        throw new Error('The pipeline source did not produce an output_id.');
      }
      const pipelineSink = await manager.executeCommand({
        command: 'cat',
        executionMode: 'foreground',
        executionBoundary: { kind: 'sandbox', profile: 'restrictive-v1' },
        workingDirectory: root,
        inputOutputId: pipelineOutputId,
        timeoutSeconds: 5,
        maxOutputSize: 1024,
        captureStderr: true,
      });
      expect(pipelineSink.stdout).toBe('pipeline-data');
      expect(pipelineSink.execution_isolation?.kind).toBe('sandbox');

      const commandFailure = await manager.executeCommand({
        command: 'exit 23',
        executionMode: 'foreground',
        executionBoundary: { kind: 'sandbox', profile: 'restrictive-v1' },
        workingDirectory: root,
        timeoutSeconds: 5,
        maxOutputSize: 1024,
        captureStderr: true,
      });
      expect(commandFailure.status).toBe('completed');
      expect(commandFailure.exit_code).toBe(23);
      expect(commandFailure.execution_isolation?.kind).toBe('sandbox');

      const timeoutResult = await manager.executeCommand({
        command: 'sleep 30',
        executionMode: 'foreground',
        executionBoundary: { kind: 'sandbox', profile: 'restrictive-v1' },
        workingDirectory: root,
        timeoutSeconds: 1,
        maxOutputSize: 1024,
        captureStderr: true,
        returnPartialOnTimeout: true,
      });
      expect(timeoutResult.status).toBe('timeout');
      expect(timeoutResult.execution_isolation?.kind).toBe('sandbox');
      expect(timeoutResult.process_id).toBeDefined();
      let providerAlive = true;
      for (let attempt = 0; attempt < 100 && providerAlive; attempt += 1) {
        try {
          process.kill(timeoutResult.process_id as number, 0);
          await new Promise((resolve) => setTimeout(resolve, 20));
        } catch {
          providerAlive = false;
        }
      }
      expect(providerAlive).toBe(false);
      manager.cleanup();
      await fileManager.cleanup();
      await Promise.all([
        fsp.rm(root, { recursive: true, force: true }),
        fsp.rm(outputDir, { recursive: true, force: true }),
        fsp.rm(fileDir, { recursive: true, force: true }),
      ]);
    },
    45000
  );
});
