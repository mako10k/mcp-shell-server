#!/usr/bin/env node

/**
 * Test JSON Repair Functionality
 * 
 * This script tests the JSON repair utility with various malformed JSON
 * examples that can occur when LLMs generate Function Call arguments.
 */

import { repairAndParseJson, advancedJsonRepair } from './src/utils/json-repair.js';

// Test cases based on real-world LLM response issues
const testCases = [
  {
    name: 'Original working JSON',
    json: '{"evaluation_result": "ALLOW", "reasoning": "This is safe"}',
    shouldWork: true
  },
  {
    name: 'Unescaped quotes in reasoning field',
    json: '{"evaluation_result": "DENY", "reasoning": "Commands with "*.log" patterns can be dangerous"}',
    shouldWork: false
  },
  {
    name: 'Single quotes instead of double quotes',
    json: "{'evaluation_result': 'ALLOW', 'reasoning': 'Simple command'}",
    shouldWork: false
  },
  {
    name: 'Trailing comma',
    json: '{"evaluation_result": "ALLOW", "reasoning": "Safe command",}',
    shouldWork: false
  },
  {
    name: 'Unquoted object keys',
    json: '{evaluation_result: "ALLOW", reasoning: "Safe command"}',
    shouldWork: false
  },
  {
    name: 'Complex quote scenario from find command',
    json: '{"evaluation_result": "CONDITIONAL_DENY", "reasoning": "The command find /tmp -name "*.log" -delete removes files"}',
    shouldWork: false
  },
  {
    name: 'Smart quotes',
    json: '{"evaluation_result": "ALLOW", "reasoning": "This uses "smart quotes" incorrectly"}',
    shouldWork: false
  }
];

console.log('=== JSON Repair Utility Test ===\n');

for (const testCase of testCases) {
  console.log(`Testing: ${testCase.name}`);
  console.log(`Input: ${testCase.json}`);
  
  // Test standard JSON.parse first
  let standardParseWorks = false;
  try {
    JSON.parse(testCase.json);
    standardParseWorks = true;
    console.log('✅ Standard JSON.parse works');
  } catch (error) {
    console.log('❌ Standard JSON.parse fails:', error.message);
  }
  
  // Test our repair function
  const repairResult = repairAndParseJson(testCase.json);
  if (repairResult.success) {
    console.log('✅ JSON repair successful');
    console.log('Parsed value:', JSON.stringify(repairResult.value, null, 2));
    if (repairResult.repairAttempts && repairResult.repairAttempts.length > 0) {
      console.log(`Used ${repairResult.repairAttempts.length} repair attempts`);
    }
  } else {
    console.log('❌ JSON repair failed');
    console.log('Original error:', repairResult.originalError);
    console.log('Final error:', repairResult.finalError);
    if (repairResult.repairAttempts) {
      console.log(`Tried ${repairResult.repairAttempts.length} repair strategies`);
    }
  }
  
  // Test advanced repair for complex cases
  if (!repairResult.success) {
    console.log('Trying advanced repair...');
    try {
      const advancedRepaired = advancedJsonRepair(testCase.json);
      const parsed = JSON.parse(advancedRepaired);
      console.log('✅ Advanced repair successful');
      console.log('Repaired JSON:', advancedRepaired);
      console.log('Parsed value:', JSON.stringify(parsed, null, 2));
    } catch (error) {
      console.log('❌ Advanced repair also failed:', error.message);
    }
  }
  
  console.log('---\n');
}

console.log('Test completed!');
