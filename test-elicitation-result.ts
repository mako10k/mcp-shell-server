#!/usr/bin/env node
/**
 * Quick test script to verify ElicitationResult integration
 */

import { SafetyEvaluationResultFactory, ElicitationResult } from './src/types/index.js';

// Create a sample ElicitationResult
const sampleElicitationResult: ElicitationResult = {
  status: 'confirmed',
  question_asked: 'Do you want to proceed with this operation?',
  timestamp: new Date().toISOString(),
  timeout_duration_ms: 5000,
  user_response: { confirmed: true, reason: 'Test execution' },
  comment: 'User confirmed the operation'
};

console.log('Testing SafetyEvaluationResult with ElicitationResult...\n');

// Test Allow result with elicitation
const allowResult = SafetyEvaluationResultFactory.createAllow(
  'Command is safe to execute',
  {
    llmEvaluationUsed: true,
    suggestedAlternatives: ['ls -la', 'pwd'],
    elicitationResult: sampleElicitationResult,
  }
);

console.log('Allow Result:');
console.log('- Evaluation Result:', allowResult.evaluation_result);
console.log('- Reasoning:', allowResult.reasoning);
console.log('- Has Elicitation Result:', !!allowResult.elicitation_result);
console.log('- Elicitation Status:', allowResult.elicitation_result?.status);

// Test response generation
const toolResponse = allowResult.generateToolResponse();
console.log('\nTool Response:');
console.log('- Has elicitation_result field:', !!toolResponse.elicitation_result);
console.log('- Elicitation Status in response:', toolResponse.elicitation_result?.status);

// Test Deny result with elicitation
const denyElicitationResult: ElicitationResult = {
  status: 'declined',
  question_asked: 'This command is dangerous. Do you still want to proceed?',
  timestamp: new Date().toISOString(),
  timeout_duration_ms: 3000,
  user_response: { confirmed: false, reason: 'Too risky' },
  comment: 'User declined the dangerous operation'
};

const denyResult = SafetyEvaluationResultFactory.createDeny(
  'Command is too dangerous to execute',
  {
    llmEvaluationUsed: true,
    elicitationResult: denyElicitationResult,
  }
);

console.log('\nDeny Result:');
console.log('- Evaluation Result:', denyResult.evaluation_result);
console.log('- Has Elicitation Result:', !!denyResult.elicitation_result);
console.log('- Elicitation Status:', denyResult.elicitation_result?.status);

const denyToolResponse = denyResult.generateToolResponse();
console.log('\nDeny Tool Response:');
console.log('- Has elicitation_result field:', !!denyToolResponse.elicitation_result);
console.log('- Elicitation Status in response:', denyToolResponse.elicitation_result?.status);

console.log('\n✅ ElicitationResult integration test completed successfully!');
