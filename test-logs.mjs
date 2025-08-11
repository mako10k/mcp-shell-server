// Function Call と ログシステムの統合テスト
import { logger, updateLogConfig } from './dist/utils/helpers.js';

// ログ設定をテスト用に更新
updateLogConfig({
  enableFileLogging: true,
  logFilePath: './logs/function-call-test.log',
  enableConsoleLogging: false // MCP Serverでは標準出力を汚さない
});

// Function Call のテストログを記録
logger.info('Function Call Integration Test Started', {
  testType: 'function-call-integration',
  timestamp: new Date().toISOString()
}, 'test-runner');

// サンプルFunction Callログ
logger.info('Function Call Security Evaluation', {
  function_name: 'evaluate_command_security',
  command: 'ls -la',
  working_directory: '/tmp',
  evaluation_result: 'ALLOW',
  reasoning: 'Safe directory listing command',
  execution_time_ms: 45
}, 'function-call');

logger.info('Function Call User Intent Reevaluation', {
  function_name: 'reevaluate_with_user_intent',
  command: 'rm test.txt',
  user_intent: 'cleanup temporary files',
  previous_result: 'CONDITIONAL_DENY',
  new_result: 'ALLOW',
  reasoning: 'User intent clarifies safe cleanup operation'
}, 'function-call');

logger.warn('Function Call Execution Warning', {
  function_name: 'evaluate_command_security',
  command: 'sudo rm -rf /',
  issue: 'Dangerous command detected',
  action: 'Blocked execution'
}, 'function-call');

logger.error('Function Call Error', {
  function_name: 'invalid_function',
  error: 'Unknown function name',
  attempted_arguments: '{"test": "data"}'
}, 'function-call');

// テスト完了ログ
logger.info('Function Call Integration Test Completed', {
  total_function_calls: 4,
  successful_calls: 3,
  failed_calls: 1,
  test_duration_ms: 125
}, 'test-runner');

console.log('Log entries created successfully!');
console.log('Check logs/function-call-test.log for file output');
console.log('Use logger.getHistory() to query in-memory logs');
