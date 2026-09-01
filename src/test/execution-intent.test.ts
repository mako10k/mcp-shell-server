import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessManager } from '../core/process-manager.js';
import { TerminalManager } from '../core/terminal-manager.js';
import { FileManager } from '../core/file-manager.js';
import { MonitoringManager } from '../core/monitoring-manager.js';
import { CommandHistoryManager } from '../core/enhanced-history-manager.js';
import {
  resolveShellExecuteIntent,
  resolveTerminalOperateIntent,
} from '../runtime/execution-intent.js';
import { SecurityManager } from '../security/manager.js';
import { ShellTools } from '../tools/shell-tools.js';
import { DEFAULT_ENHANCED_SECURITY_CONFIG } from '../types/enhanced-security.js';
import type { TerminalInfo } from '../types/index.js';

describe('confirmed execution intent', () => {
  let processManager: ProcessManager;
  let terminalManager: TerminalManager;
  let fileManager: FileManager;
  let monitoringManager: MonitoringManager;
  let securityManager: SecurityManager;
  let historyManager: CommandHistoryManager;
  let shellTools: ShellTools;
  let environmentSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    environmentSnapshot = {
      MCP_SHELL_SECURITY_MODE: process.env['MCP_SHELL_SECURITY_MODE'],
      MCP_SHELL_ENHANCED_MODE: process.env['MCP_SHELL_ENHANCED_MODE'],
      MCP_SHELL_LLM_EVALUATION: process.env['MCP_SHELL_LLM_EVALUATION'],
    };
    process.env['MCP_SHELL_SECURITY_MODE'] = 'permissive';
    process.env['MCP_SHELL_ENHANCED_MODE'] = 'false';
    process.env['MCP_SHELL_LLM_EVALUATION'] = 'false';

    fileManager = new FileManager();
    processManager = new ProcessManager(5, '/tmp/mcp-shell-intent-test', fileManager);
    terminalManager = new TerminalManager();
    monitoringManager = new MonitoringManager();
    securityManager = new SecurityManager();
    historyManager = new CommandHistoryManager(DEFAULT_ENHANCED_SECURITY_CONFIG);
    shellTools = new ShellTools(
      processManager,
      terminalManager,
      fileManager,
      monitoringManager,
      securityManager,
      historyManager
    );
  });

  afterEach(() => {
    processManager.cleanup();
    terminalManager.cleanup();
    fileManager.cleanup();
    monitoringManager.cleanup();
    process.env['MCP_SHELL_SECURITY_MODE'] = environmentSnapshot.MCP_SHELL_SECURITY_MODE;
    process.env['MCP_SHELL_ENHANCED_MODE'] = environmentSnapshot.MCP_SHELL_ENHANCED_MODE;
    process.env['MCP_SHELL_LLM_EVALUATION'] = environmentSnapshot.MCP_SHELL_LLM_EVALUATION;
    vi.restoreAllMocks();
  });

  it('preserves exact shell command, stdin, environment, and working directory for confirmation and execution', async () => {
    const command = '  printf "unchanged"  \n';
    const inputData = '\tprivate input\n';
    const intent = resolveShellExecuteIntent({
      command,
      input_data: inputData,
      working_directory: '/tmp/exact directory',
      environment_variables: { EXACT_VALUE: '  keep spaces  ' },
      execution_mode: 'foreground',
      timeout_seconds: 10,
      foreground_timeout_seconds: 10,
    });
    const commandConfirmation = intent.confirmation.payloads.find(
      (payload) => payload.label === 'Shell command (exact text)'
    );
    const stdinConfirmation = intent.confirmation.payloads.find(
      (payload) => payload.label === 'Standard input (exact text)'
    );
    const executeCommand = vi.spyOn(processManager, 'executeCommand').mockResolvedValue({
      execution_id: 'execution-intent-test',
      command,
      status: 'completed',
      working_directory: '/tmp/exact directory',
      created_at: '2026-09-01T00:00:00.000Z',
      started_at: '2026-09-01T00:00:00.000Z',
    });
    vi.spyOn(securityManager, 'auditCommand').mockImplementation(() => undefined);
    vi.spyOn(historyManager, 'addHistoryEntry').mockResolvedValue(undefined);

    await shellTools.executeShellIntent(intent);

    expect(commandConfirmation?.value).toBe(command);
    expect(stdinConfirmation?.value).toBe(inputData);
    expect(executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command,
        inputData,
        workingDirectory: '/tmp/exact directory',
        environmentVariables: { EXACT_VALUE: '  keep spaces  ' },
      })
    );
  });

  it('rejects ambiguous terminal command and input before any mutation', async () => {
    const mutationCheck = vi.spyOn(securityManager, 'assertTerminalMutationAllowed');
    const createTerminal = vi.spyOn(terminalManager, 'createTerminal');
    const getTerminal = vi.spyOn(terminalManager, 'getTerminal');
    const sendInput = vi.spyOn(terminalManager, 'sendInput');

    await expect(
      shellTools.terminalOperateValidated({
        terminal_id: 'terminal-1',
        command: 'displayed command',
        input: 'different transmitted input',
      })
    ).rejects.toThrow('command and input cannot be specified together');

    expect(mutationCheck).not.toHaveBeenCalled();
    expect(createTerminal).not.toHaveBeenCalled();
    expect(getTerminal).not.toHaveBeenCalled();
    expect(sendInput).not.toHaveBeenCalled();
  });

  it('sends the exact existing-terminal payload and effects shown by the confirmation model', async () => {
    const terminalInfo = createTerminalInfo('terminal-1');
    vi.spyOn(securityManager, 'assertTerminalMutationAllowed').mockImplementation(() => undefined);
    vi.spyOn(terminalManager, 'getTerminal').mockResolvedValue(terminalInfo);
    const sendInput = vi.spyOn(terminalManager, 'sendInput').mockResolvedValue({
      success: true,
      timestamp: '2026-09-01T00:00:00.000Z',
    });
    const intent = resolveTerminalOperateIntent({
      terminal_id: terminalInfo.terminal_id,
      input: '  \\x03  ',
      execute: false,
      control_codes: true,
      send_to: 'pid:4242',
      force_input: true,
      get_output: false,
      output_delay_ms: 0,
    });

    await shellTools.terminalOperateIntent(intent);

    expect(intent.confirmation.payloads[0]?.value).toBe(intent.input?.value);
    expect(sendInput).toHaveBeenCalledWith(
      terminalInfo.terminal_id,
      intent.confirmation.payloads[0]?.value,
      false,
      true,
      false,
      'pid:4242'
    );
  });

  it('honors execute=false for a command sent while creating a terminal', async () => {
    const terminalInfo = createTerminalInfo('terminal-new');
    vi.spyOn(securityManager, 'assertTerminalMutationAllowed').mockImplementation(() => undefined);
    vi.spyOn(terminalManager, 'createTerminal').mockResolvedValue(terminalInfo);
    const sendInput = vi.spyOn(terminalManager, 'sendInput').mockResolvedValue({
      success: true,
      timestamp: '2026-09-01T00:00:00.000Z',
    });
    const intent = resolveTerminalOperateIntent({
      command: 'printf "typed but not executed"',
      execute: false,
      get_output: false,
      output_delay_ms: 0,
    });

    await shellTools.terminalOperateIntent(intent);

    expect(intent.input?.execute).toBe(false);
    expect(sendInput).toHaveBeenCalledWith(
      terminalInfo.terminal_id,
      intent.confirmation.payloads[0]?.value,
      false,
      false,
      false,
      undefined
    );
  });
});

function createTerminalInfo(terminalId: string): TerminalInfo {
  return {
    terminal_id: terminalId,
    session_name: 'intent-test',
    shell_type: 'bash',
    dimensions: { width: 120, height: 30 },
    process_id: 4242,
    status: 'active',
    working_directory: '/tmp',
    created_at: '2026-09-01T00:00:00.000Z',
    last_activity: '2026-09-01T00:00:00.000Z',
  };
}
