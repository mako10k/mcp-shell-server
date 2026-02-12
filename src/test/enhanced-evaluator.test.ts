import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { EnhancedSafetyEvaluator } from '../../packages/shell-server/src/security/enhanced-evaluator.js';
import { SecurityManager } from '../../packages/shell-server/src/security/manager.js';
import { CommandHistoryManager } from '../../packages/shell-server/src/core/enhanced-history-manager.js';
import { DEFAULT_ENHANCED_SECURITY_CONFIG, SimplifiedLLMEvaluationResult } from '../../packages/shell-server/src/types/enhanced-security.js';

const createMessage = vi.fn().mockResolvedValue({ content: { type: 'text', text: '' } });

describe('EnhancedSafetyEvaluator', () => {
  let securityManager: SecurityManager;
  let historyManager: CommandHistoryManager;
  let evaluator: EnhancedSafetyEvaluator;

  beforeEach(() => {
    securityManager = new SecurityManager();
    historyManager = new CommandHistoryManager(DEFAULT_ENHANCED_SECURITY_CONFIG);
    evaluator = new EnhancedSafetyEvaluator(securityManager, historyManager, createMessage);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('should return allow for basic safe commands via function call', async () => {
    const result = await evaluator.executeTestFunctionCall(
      {
        name: 'evaluate_command_security',
        arguments: JSON.stringify({
          command: 'ls -la',
          working_directory: '/tmp'
        })
      },
      { command: 'ls -la' }
    );

    expect(result.success).toBe(true);
    const evaluation = result.result as SimplifiedLLMEvaluationResult;
    expect(evaluation.evaluation_result).toBe('allow');
    expect(typeof evaluation.reasoning).toBe('string');
  });

  test('should require confirmation for risky commands via function call', async () => {
    const result = await evaluator.executeTestFunctionCall(
      {
        name: 'evaluate_command_security',
        arguments: JSON.stringify({
          command: 'rm -rf /',
          working_directory: '/'
        })
      },
      { command: 'rm -rf /' }
    );

    expect(result.success).toBe(true);
    const evaluation = result.result as SimplifiedLLMEvaluationResult;
    expect(evaluation.evaluation_result).toBe('user_confirm');
  });

  test('should reject invalid function call arguments', async () => {
    const result = await evaluator.executeTestFunctionCall(
      {
        name: 'evaluate_command_security',
        arguments: JSON.stringify({
          working_directory: '/tmp'
        })
      },
      { command: 'ls -la' }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
