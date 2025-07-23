import { describe, test, expect, beforeAll } from 'vitest';
import { ShellTools } from '../tools/shell-tools.js';
import { ProcessManager } from '../core/process-manager.js';
import { TerminalManager } from '../core/terminal-manager.js';
import { FileManager } from '../core/file-manager.js';
import { MonitoringManager } from '../core/monitoring-manager.js';
import { SecurityManager } from '../security/manager.js';

describe('Pipeline Output Feature (Issue #13)', () => {
  let shellTools: ShellTools;
  let processManager: ProcessManager;
  let fileManager: FileManager;

  beforeAll(() => {
    fileManager = new FileManager('/tmp/mcp-shell-test-pipeline');
    processManager = new ProcessManager(50, '/tmp/mcp-shell-test-pipeline', fileManager);
    processManager.setFileManager(fileManager);
    
    const terminalManager = new TerminalManager();
    const monitoringManager = new MonitoringManager();
    const securityManager = new SecurityManager();
    
    shellTools = new ShellTools(
      processManager,
      terminalManager,
      fileManager,
      monitoringManager,
      securityManager
    );
  });

  describe('Phase 1: Completed Output Transfer (File→stdin)', () => {
    test('should use previous command output as input for next command', async () => {
      // Step 1: Execute first command that generates output
      const firstResult = await shellTools.executeShell({
        command: 'echo "Hello Pipeline World"',
        execution_mode: 'foreground',
        timeout_seconds: 10,
        foreground_timeout_seconds: 10,
        max_output_size: 1048576,
        capture_stderr: true,
        return_partial_on_timeout: true,
        create_terminal: false
      });

      expect(firstResult.status).toBe('completed');
      expect(firstResult.output_id).toBeDefined();
      expect(firstResult.stdout).toContain('Hello Pipeline World');

      // Step 2: Use first command's output as input for second command
      const secondResult = await shellTools.executeShell({
        command: 'grep "Pipeline"',
        execution_mode: 'foreground',
        timeout_seconds: 10,
        foreground_timeout_seconds: 10,
        max_output_size: 1048576,
        capture_stderr: true,
        return_partial_on_timeout: true,
        create_terminal: false,
        input_output_id: firstResult.output_id
      });

      expect(secondResult.status).toBe('completed');
      expect(secondResult.stdout).toContain('Hello Pipeline World');
    });

    test('should reject when both input_data and input_output_id are provided', async () => {
      const firstResult = await shellTools.executeShell({
        command: 'echo "test data"',
        execution_mode: 'foreground',
        timeout_seconds: 10,
        foreground_timeout_seconds: 10,
        max_output_size: 1048576,
        capture_stderr: true,
        return_partial_on_timeout: true,
        create_terminal: false
      });

      // This should fail due to validation
      await expect(shellTools.executeShell({
        command: 'cat',
        execution_mode: 'foreground',
        timeout_seconds: 10,
        foreground_timeout_seconds: 10,
        max_output_size: 1048576,
        capture_stderr: true,
        return_partial_on_timeout: true,
        create_terminal: false,
        input_data: 'direct input',
        input_output_id: firstResult.output_id
      })).rejects.toThrow();
    });

    test('should handle non-existent output_id gracefully', async () => {
      await expect(shellTools.executeShell({
        command: 'cat',
        execution_mode: 'foreground',
        timeout_seconds: 10,
        foreground_timeout_seconds: 10,
        max_output_size: 1048576,
        capture_stderr: true,
        return_partial_on_timeout: true,
        create_terminal: false,
        input_output_id: 'non-existent-id'
      })).rejects.toThrow(/Failed to read input from output_id/);
    });

    test('should work with complex pipeline transformations', async () => {
      // Generate some test data
      const dataResult = await shellTools.executeShell({
        command: 'echo -e "apple\\nbanana\\ncherry\\napricot"',
        execution_mode: 'foreground',
        timeout_seconds: 10,
        foreground_timeout_seconds: 10,
        max_output_size: 1048576,
        capture_stderr: true,
        return_partial_on_timeout: true,
        create_terminal: false
      });

      // Filter data starting with 'a'
      const filterResult = await shellTools.executeShell({
        command: 'grep "^a"',
        execution_mode: 'foreground',
        timeout_seconds: 10,
        foreground_timeout_seconds: 10,
        max_output_size: 1048576,
        capture_stderr: true,
        return_partial_on_timeout: true,
        create_terminal: false,
        input_output_id: dataResult.output_id
      });

      expect(filterResult.status).toBe('completed');
      expect(filterResult.stdout).toContain('apple');
      expect(filterResult.stdout).toContain('apricot');
      expect(filterResult.stdout).not.toContain('banana');
      expect(filterResult.stdout).not.toContain('cherry');

      // Count the results
      const countResult = await shellTools.executeShell({
        command: 'wc -l',
        execution_mode: 'foreground',
        timeout_seconds: 10,
        foreground_timeout_seconds: 10,
        max_output_size: 1048576,
        capture_stderr: true,
        return_partial_on_timeout: true,
        create_terminal: false,
        input_output_id: filterResult.output_id
      });

      expect(countResult.status).toBe('completed');
      expect(countResult.stdout?.trim()).toBe('2');
    });
  });
});
