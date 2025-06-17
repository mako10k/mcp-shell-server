#!/usr/bin/env node

/**
 * MCP Shell Server - プログラムガード機能のデモ
 * 
 * このスクリプトは、プログラムガード機能の使用例を示します。
 */

console.log('MCP Shell Server - プログラムガード機能');
console.log('==========================================');
console.log();

// 1. ターミナル作成の例
console.log('1. ターミナル作成');
console.log('=================');
const createTerminalExample = {
  shell_type: 'bash',
  dimensions: { width: 80, height: 24 },
  session_name: 'demo-terminal',
  auto_save_history: true
};
console.log('terminal_create:');
console.log(JSON.stringify(createTerminalExample, null, 2));
console.log();

// 2. プログラムガード付き入力の例
console.log('2. プログラムガード付き入力');
console.log('============================');

const guardExamples = [
  {
    name: 'bashプロセスのみに送信',
    params: {
      terminal_id: 'terminal_123',
      input: 'echo "Hello from bash"',
      send_to: 'bash',
      execute: true
    }
  },
  {
    name: '特定のPIDのプロセスのみに送信',
    params: {
      terminal_id: 'terminal_123',
      input: '^C',
      send_to: 'pid:12345',
      control_codes: true
    }
  },
  {
    name: 'セッションリーダーのみに送信',
    params: {
      terminal_id: 'terminal_123',
      input: 'logout',
      send_to: 'sessionleader:',
      execute: true
    }
  },
  {
    name: 'フルパス指定',
    params: {
      terminal_id: 'terminal_123',
      input: 'ls -la',
      send_to: '/bin/bash',
      execute: true
    }
  },
  {
    name: '制限なし',
    params: {
      terminal_id: 'terminal_123',
      input: 'any command',
      send_to: '*',
      execute: true
    }
  }
];

guardExamples.forEach((example, index) => {
  console.log(`${index + 1}. ${example.name}`);
  console.log('terminal_input:');
  console.log(JSON.stringify(example.params, null, 2));
  console.log();
});

// 3. フォアグラウンドプロセス情報取得の例
console.log('3. フォアグラウンドプロセス情報取得');
console.log('==================================');

const getProcessInfoExample = {
  terminal_id: 'terminal_123',
  include_foreground_process: true
};
console.log('terminal_output:');
console.log(JSON.stringify(getProcessInfoExample, null, 2));
console.log();

// 4. 期待されるレスポンス例
console.log('4. 期待されるレスポンス例');
console.log('========================');

console.log('terminal_input のレスポンス（成功）:');
const successResponse = {
  success: true,
  input_sent: 'echo "Hello from bash"',
  control_codes_enabled: false,
  raw_bytes_mode: false,
  program_guard: {
    passed: true,
    target: 'bash'
  },
  timestamp: '2025-06-17T10:30:00Z'
};
console.log(JSON.stringify(successResponse, null, 2));
console.log();

console.log('terminal_input のレスポンス（ガード失敗）:');
const guardFailResponse = {
  error: {
    code: 'EXECUTION_ERROR',
    message: 'Program guard failed: input rejected for target "vim"'
  }
};
console.log(JSON.stringify(guardFailResponse, null, 2));
console.log();

console.log('terminal_output のレスポンス（プロセス情報付き）:');
const outputWithProcessResponse = {
  terminal_id: 'terminal_123',
  output: 'Hello from bash\\nuser@host:~$ ',
  line_count: 2,
  total_lines: 50,
  has_more: true,
  foreground_process: {
    available: true,
    process: {
      pid: 12345,
      name: 'bash',
      path: '/bin/bash',
      sessionId: 12340,
      isSessionLeader: true,
      parentPid: 1234
    }
  }
};
console.log(JSON.stringify(outputWithProcessResponse, null, 2));
console.log();

// 5. セキュリティのポイント
console.log('5. セキュリティのポイント');
console.log('========================');
console.log('• フォアグラウンドプロセスが検出できない場合、入力は拒否されます');
console.log('• プロセス情報はキャッシュされ、パフォーマンスが最適化されています');
console.log('• ガード条件に一致しないプロセスへの入力は安全に拒否されます');
console.log('• セッションリーダーの検出により、シェルレベルの制御が可能です');
console.log();

console.log('使用方法の詳細は docs/program-guard.md を参照してください。');
