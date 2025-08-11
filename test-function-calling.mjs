#!/usr/bin/env node

/**
 * Test Function Calling implementation for security evaluation
 */

import { securityEvaluationTool } from '../src/security/security-tools.js';

console.log('Security Evaluation Tool Definition:');
console.log(JSON.stringify(securityEvaluationTool, null, 2));

// Test the tool schema
console.log('\nTool Schema Validation:');
const testParameters = {
  evaluation_result: 'ALLOW',
  reasoning: 'Test command is safe',
  requires_additional_context: {
    command_history_depth: 0,
    execution_results_count: 0,
    user_intent_search_keywords: null,
    user_intent_question: null
  },
  suggested_alternatives: []
};

console.log('Test Parameters:', JSON.stringify(testParameters, null, 2));

// Simulate a tool call response
const mockToolCall = {
  id: 'test-call-123',
  type: 'function',
  function: {
    name: 'evaluate_command_security',
    arguments: JSON.stringify(testParameters)
  }
};

console.log('\nMock Tool Call:', JSON.stringify(mockToolCall, null, 2));

try {
  const parsed = JSON.parse(mockToolCall.function.arguments);
  console.log('\nParsed Arguments:', parsed);
  console.log('✅ Tool call parsing successful');
} catch (error) {
  console.error('❌ Tool call parsing failed:', error);
}
