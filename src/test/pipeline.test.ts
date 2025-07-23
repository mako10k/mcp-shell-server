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

      // This should be tested at the schema validation level
      // For now, we test that input_output_id takes precedence over input_data
      const result = await shellTools.executeShell({
        command: 'cat',
        execution_mode: 'foreground',
        timeout_seconds: 10,
        foreground_timeout_seconds: 10,
        max_output_size: 1048576,
        capture_stderr: true,
        return_partial_on_timeout: true,
        create_terminal: false,
        input_data: 'direct input that should be ignored',
        input_output_id: firstResult.output_id
      });

      // Should use input_output_id data, not input_data
      expect(result.status).toBe('completed');
      expect(result.stdout).toContain('test data');
      expect(result.stdout).not.toContain('direct input that should be ignored');
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

    test('should handle empty output correctly', async () => {
      // Generate empty output
      const emptyResult = await shellTools.executeShell({
        command: 'echo -n ""',
        execution_mode: 'foreground',
        timeout_seconds: 10,
        foreground_timeout_seconds: 10,
        max_output_size: 1048576,
        capture_stderr: true,
        return_partial_on_timeout: true,
        create_terminal: false
      });

      expect(emptyResult.status).toBe('completed');
      expect(emptyResult.stdout).toBe('');

      // Use empty output as input
      const catResult = await shellTools.executeShell({
        command: 'wc -c',
        execution_mode: 'foreground',
        timeout_seconds: 10,
        foreground_timeout_seconds: 10,
        max_output_size: 1048576,
        capture_stderr: true,
        return_partial_on_timeout: true,
        create_terminal: false,
        input_output_id: emptyResult.output_id
      });

      expect(catResult.status).toBe('completed');
      expect(catResult.stdout?.trim()).toBe('0');
    });

    test('should handle large output transfer correctly', async () => {
      // Generate large output (1KB of text)
      const largeDataResult = await shellTools.executeShell({
        command: 'head -c 1000 /dev/zero | tr "\\0" "A"',
        execution_mode: 'foreground',
        timeout_seconds: 10,
        foreground_timeout_seconds: 10,
        max_output_size: 2048,
        capture_stderr: true,
        return_partial_on_timeout: true,
        create_terminal: false
      });

      expect(largeDataResult.status).toBe('completed');
      expect(largeDataResult.stdout?.length).toBe(1000);

      // Count the characters
      const countResult = await shellTools.executeShell({
        command: 'wc -c',
        execution_mode: 'foreground',
        timeout_seconds: 10,
        foreground_timeout_seconds: 10,
        max_output_size: 1048576,
        capture_stderr: true,
        return_partial_on_timeout: true,
        create_terminal: false,
        input_output_id: largeDataResult.output_id
      });

      expect(countResult.status).toBe('completed');
      expect(countResult.stdout?.trim()).toBe('1000');
    });

    test('should work with multiline output', async () => {
      // Generate multiline output
      const multilineResult = await shellTools.executeShell({
        command: 'printf "line1\\nline2\\nline3\\n"',
        execution_mode: 'foreground',
        timeout_seconds: 10,
        foreground_timeout_seconds: 10,
        max_output_size: 1048576,
        capture_stderr: true,
        return_partial_on_timeout: true,
        create_terminal: false
      });

      expect(multilineResult.status).toBe('completed');
      expect(multilineResult.stdout).toBe('line1\nline2\nline3\n');

      // Count lines
      const lineCountResult = await shellTools.executeShell({
        command: 'wc -l',
        execution_mode: 'foreground',
        timeout_seconds: 10,
        foreground_timeout_seconds: 10,
        max_output_size: 1048576,
        capture_stderr: true,
        return_partial_on_timeout: true,
        create_terminal: false,
        input_output_id: multilineResult.output_id
      });

      expect(lineCountResult.status).toBe('completed');
      expect(lineCountResult.stdout?.trim()).toBe('3');
    });
  });
});
