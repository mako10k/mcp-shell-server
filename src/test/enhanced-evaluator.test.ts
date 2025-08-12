import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { EnhancedSafetyEvaluator } from '../../src/security/enhanced-evaluator.js';
import { SecurityManager } from '../../src/security/manager.js';
import { CommandHistoryManager } from '../../src/core/enhanced-history-manager.js';
import { DEFAULT_ENHANCED_SECURITY_CONFIG } from '../../src/types/enhanced-security.js';

describe('EnhancedSafetyEvaluator', () => {
  let securityManager: SecurityManager;
  let historyManager: CommandHistoryManager;
  let evaluator: EnhancedSafetyEvaluator;

  beforeEach(() => {
    securityManager = new SecurityManager();
    historyManager = new CommandHistoryManager(DEFAULT_ENHANCED_SECURITY_CONFIG);
    evaluator = new EnhancedSafetyEvaluator(securityManager, historyManager);
  });

  afterEach(() => {
    // Cleanup
  });

  describe('evaluateCommand', () => {
    test('should allow safe commands', async () => {
      const result = await evaluator.evaluateCommand('ls -la', '/tmp');

      expect(result.evaluation_result).toBe('ALLOW');
      expect(result.safety_level).toBeLessThanOrEqual(2);
      expect(result.requires_confirmation).toBe(false);
    });

    test('should flag potentially dangerous commands', async () => {
      const result = await evaluator.evaluateCommand('rm -rf /', '/');

      expect(['NEED_ASSISTANT_CONFIRM', 'NEED_USER_CONFIRM', 'DENY']).toContain(result.evaluation_result);
      expect(result.safety_level).toBeGreaterThan(3);
      expect(result.requires_confirmation).toBe(true);
    });

    test('should consider working directory risk', async () => {
      const sensitiveResult = await evaluator.evaluateCommand('chmod 777 *', '/etc');
      const normalResult = await evaluator.evaluateCommand('chmod 777 *', '/tmp');

      expect(sensitiveResult.safety_level).toBeGreaterThan(normalResult.safety_level);
    });

    test('should provide reasoning for evaluations', async () => {
      const result = await evaluator.evaluateCommand('sudo rm important_file', '/etc');

      expect(result.reasoning).toBeDefined();
      expect(result.reasoning.length).toBeGreaterThan(0);
      expect(result.reasoning).toContain('escalation');
    });

    test('should suggest alternatives for risky commands', async () => {
      const result = await evaluator.evaluateCommand('rm file.txt', '/home');

      if (result.suggested_alternatives.length > 0) {
        expect(result.suggested_alternatives).toContain(expect.stringContaining('rm -i'));
      }
    });
  });

  describe('contextual analysis', () => {
    test('should detect repeated command patterns', async () => {
      // Add some history entries first
      await historyManager.addHistoryEntry({
        command: 'rm file1.txt',
        working_directory: '/tmp',
        was_executed: true,
        resubmission_count: 0,
        safety_classification: 'llm_required',
      });

      await historyManager.addHistoryEntry({
        command: 'rm file2.txt',
        working_directory: '/tmp',
        was_executed: true,
        resubmission_count: 0,
        safety_classification: 'llm_required',
      });

      const result = await evaluator.evaluateCommand('rm file3.txt', '/tmp');

      // Should notice the pattern of repeated rm commands
      expect(result.contextual_evaluation.analysis.repeated_pattern.frequency).toBeGreaterThan(0);
    });

    test('should detect privilege escalation attempts', async () => {
      const result = await evaluator.evaluateCommand('sudo chown root:root /etc/passwd', '/etc');

      expect(result.contextual_evaluation.analysis.escalation_risk.has_escalation).toBe(true);
      expect(result.contextual_evaluation.analysis.escalation_risk.risk_level).toBeGreaterThan(3);
    });

    test('should identify sensitive directory operations', async () => {
      const result = await evaluator.evaluateCommand('touch new_config', '/etc');

      expect(
        result.contextual_evaluation.analysis.working_directory_risk.is_sensitive_directory
      ).toBe(true);
      expect(
        result.contextual_evaluation.analysis.working_directory_risk.risk_level
      ).toBeGreaterThan(1);
    });
  });

  describe('evaluation combination', () => {
    test('should combine basic and contextual evaluations correctly', async () => {
      // Basic safe command in safe directory
      const safeResult = await evaluator.evaluateCommand('echo hello', '/tmp');
      expect(safeResult.evaluation_result).toBe('ALLOW');

      // Basic safe command in sensitive directory
      const sensitiveResult = await evaluator.evaluateCommand('echo hello', '/etc');
      expect(sensitiveResult.safety_level).toBeGreaterThanOrEqual(safeResult.safety_level);
    });

    test('should provide confidence scores', async () => {
      const result = await evaluator.evaluateCommand('ls', '/tmp');

      expect(result.confidence).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('error handling', () => {
    test('should handle empty command gracefully', async () => {
      const result = await evaluator.evaluateCommand('', '/tmp');

      expect(result).toBeDefined();
      expect(['ALLOW', 'NEED_ASSISTANT_CONFIRM', 'NEED_USER_CONFIRM', 'DENY']).toContain(result.evaluation_result);
    });

    test('should handle malformed commands', async () => {
      const result = await evaluator.evaluateCommand('invalid|||command###', '/tmp');

      expect(result).toBeDefined();
      expect(result.reasoning).toBeDefined();
    });
  });
});
