import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { EnhancedSafetyEvaluator } from '../security/enhanced-evaluator.js';
import { SecurityManager } from '../security/manager.js';
import { CommandHistoryManager } from '../core/enhanced-history-manager.js';
import { 
  DEFAULT_ENHANCED_SECURITY_CONFIG,
  FunctionCallResult,
  FunctionCallContext,
  EvaluateCommandSecurityArgs,
  ReevaluateWithUserIntentArgs,
  SimplifiedLLMEvaluationResult
} from '../types/enhanced-security.js';

describe('Function Call Integration Tests', () => {
  let securityManager: SecurityManager;
  let historyManager: CommandHistoryManager;
  let evaluator: EnhancedSafetyEvaluator;

  beforeEach(() => {
    securityManager = new SecurityManager();
    historyManager = new CommandHistoryManager(DEFAULT_ENHANCED_SECURITY_CONFIG);
    evaluator = new EnhancedSafetyEvaluator(securityManager, historyManager);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Function Call Handler Registration', () => {
    test('should register all required function call handlers', () => {
      // Access the function call registry
      const registry = evaluator.getFunctionCallRegistry();
      
      expect(registry).toBeDefined();
      expect(registry.has('evaluate_command_security')).toBe(true);
      expect(registry.has('reevaluate_with_user_intent')).toBe(true);
      expect(registry.has('reevaluate_with_additional_context')).toBe(true);
    });

    test('should have properly typed function call handlers', () => {
      const registry = evaluator.getFunctionCallRegistry();
      const handler = registry.get('evaluate_command_security');
      
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });
  });

  describe('Function Call Execution', () => {
    test('should execute evaluate_command_security function call', async () => {
      const functionCall = {
        name: 'evaluate_command_security',
        arguments: JSON.stringify({
          command: 'ls -la',
          working_directory: '/tmp',
          additional_context: 'Test execution'
        } as EvaluateCommandSecurityArgs)
      };

      const context: FunctionCallContext = {
        command: 'ls -la',
        comment: 'Test execution'
      };

      const result = await evaluator.executeTestFunctionCall(functionCall, context);

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      
      if (result.success && result.result) {
        const evaluation = result.result as SimplifiedLLMEvaluationResult;
        expect(evaluation.evaluation_result).toMatch(/^(ALLOW|CONDITIONAL_ALLOW|CONDITIONAL_DENY|DENY|NEED_MORE_INFO)$/);
        expect(typeof evaluation.reasoning).toBe('string');
        expect(Array.isArray(evaluation.suggested_alternatives)).toBe(true);
      }
    });

    test('should handle invalid function call names', async () => {
      const functionCall = {
        name: 'invalid_function_name',
        arguments: '{}'
      };

      const context: FunctionCallContext = {
        command: 'test',
      };

      const result = await evaluator.executeTestFunctionCall(functionCall, context);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Unknown function');
    });

    test('should handle malformed function call arguments', async () => {
      const functionCall = {
        name: 'evaluate_command_security',
        arguments: 'invalid json'
      };

      const context: FunctionCallContext = {
        command: 'test',
      };

      const result = await evaluator.executeTestFunctionCall(functionCall, context);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should execute reevaluate_with_user_intent function call', async () => {
      const functionCall = {
        name: 'reevaluate_with_user_intent',
        arguments: JSON.stringify({
          command: 'rm test.txt',
          working_directory: '/tmp',
          additional_context: 'Removing temporary test file',
          user_intent: 'cleanup',
          previous_evaluation: {
            evaluation_result: 'CONDITIONAL_DENY',
            reasoning: 'File deletion requires confirmation',
            requires_additional_context: {
              command_history_depth: 0,
              execution_results_count: 0,
              user_intent_search_keywords: null,
              user_intent_question: null
            },
            suggested_alternatives: ['Use rm with specific filename']
          }
        } as ReevaluateWithUserIntentArgs)
      };

      const context: FunctionCallContext = {
        command: 'rm test.txt',
        comment: 'cleanup operation'
      };

      const result = await evaluator.executeTestFunctionCall(functionCall, context);

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      
      if (result.success && result.result) {
        const evaluation = result.result as SimplifiedLLMEvaluationResult;
        expect(evaluation.evaluation_result).toMatch(/^(ALLOW|CONDITIONAL_ALLOW|CONDITIONAL_DENY|DENY|NEED_MORE_INFO)$/);
        expect(typeof evaluation.reasoning).toBe('string');
      }
    });
  });

  describe('Function Call Error Handling', () => {
    test('should handle missing required arguments', async () => {
      const functionCall = {
        name: 'evaluate_command_security',
        arguments: JSON.stringify({
          // missing 'command' field
          working_directory: '/tmp'
        })
      };

      const context: FunctionCallContext = {
        command: 'test',
      };

      const result = await evaluator.executeTestFunctionCall(functionCall, context);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should handle function call execution exceptions', async () => {
      // Mock the registry to throw an error
      const registry = evaluator.getFunctionCallRegistry();
      const originalHandler = registry.get('evaluate_command_security');
      
      const mockHandler = vi.fn().mockRejectedValue(new Error('Test error'));
      registry.set('evaluate_command_security', mockHandler);

      const functionCall = {
        name: 'evaluate_command_security',
        arguments: JSON.stringify({
          command: 'ls -la',
          working_directory: '/tmp'
        })
      };

      const context: FunctionCallContext = {
        command: 'ls -la',
      };

      const result = await evaluator.executeTestFunctionCall(functionCall, context);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Test error');

      // Restore original handler
      if (originalHandler) {
        registry.set('evaluate_command_security', originalHandler);
      }
    });
  });

  describe('Function Call Context Handling', () => {
    test('should preserve context in function calls', async () => {
      const functionCall = {
        name: 'evaluate_command_security',
        arguments: JSON.stringify({
          command: 'echo "test"',
          working_directory: '/tmp'
        })
      };

      const context: FunctionCallContext = {
        command: 'echo "test"',
        comment: 'test command'
      };

      const result = await evaluator.executeTestFunctionCall(functionCall, context);

      expect(result.success).toBe(true);
      expect(result.context).toBeDefined();
      expect(result.context?.command).toBe('echo "test"');
      expect(result.context?.comment).toBe('test command');
    });

    test('should handle different command contexts', async () => {
      const testCases = [
        { command: 'pwd', workingDir: '/tmp' },
        { command: 'ls -la', workingDir: '/home' },
        { command: 'cat README.md', workingDir: '/project' }
      ];

      for (const testCase of testCases) {
        const functionCall = {
          name: 'evaluate_command_security',
          arguments: JSON.stringify({
            command: testCase.command,
            working_directory: testCase.workingDir
          })
        };

        const context: FunctionCallContext = {
          command: testCase.command,
        };

        const result = await evaluator.executeTestFunctionCall(functionCall, context);

        expect(result.success).toBe(true);
        expect(result.result).toBeDefined();
        
        if (result.success && result.result) {
          const evaluation = result.result as SimplifiedLLMEvaluationResult;
          expect(evaluation.evaluation_result).toMatch(/^(ALLOW|CONDITIONAL_ALLOW|CONDITIONAL_DENY|DENY|NEED_MORE_INFO)$/);
        }
      }
    });
  });

  describe('LLM Integration with Function Calls', () => {
    test('should integrate function calls with LLM sampling when available', async () => {
      // Mock LLM sampling callback
      const mockSamplingCallback = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Test LLM response' }]
      });

      securityManager.setLLMSamplingCallback(mockSamplingCallback);

      const functionCall = {
        name: 'evaluate_command_security',
        arguments: JSON.stringify({
          command: 'complex-command --with-flags',
          working_directory: '/tmp',
          additional_context: 'Complex operation requiring LLM evaluation'
        })
      };

      const context: FunctionCallContext = {
        command: 'complex-command --with-flags',
        comment: 'complex operation'
      };

      const result = await evaluator.executeTestFunctionCall(functionCall, context);

      expect(result.success).toBe(true);
      // Note: The actual LLM integration depends on command complexity and configuration
    });

    test('should fallback gracefully when LLM is unavailable', async () => {
      // Note: LLM callback cannot be unset once set, but this tests the case where
      // the evaluator handles commands without requiring LLM integration

      const functionCall = {
        name: 'evaluate_command_security',
        arguments: JSON.stringify({
          command: 'potentially-risky-command',
          working_directory: '/tmp'
        })
      };

      const context: FunctionCallContext = {
        command: 'potentially-risky-command',
      };

      const result = await evaluator.executeTestFunctionCall(functionCall, context);

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      // Should still provide a security evaluation using built-in rules
    });
  });
});
