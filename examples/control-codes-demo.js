#!/usr/bin/env node

/**
 * MCP Shell Server - 制御コード送信のデモ
 * 
 * このスクリプトは、MCP Shell Serverの制御コード送信機能をデモンストレーションします。
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// サーバーの設定
const server = new Server(
  {
    name: 'mcp-shell-demo',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 制御コード送信の例
const controlCodeExamples = {
  // プロセス中断
  interruptProcess: {
    terminal_id: 'terminal_123',
    input: '^C',
    control_codes: true
  },
  
  // 画面クリア
  clearScreen: {
    terminal_id: 'terminal_123', 
    input: '^L',
    control_codes: true
  },
  
  // ESCキー送信
  escapeKey: {
    terminal_id: 'terminal_123',
    input: '\\x1b',
    control_codes: true
  },
  
  // 色付きテキスト (ANSI エスケープシーケンス)
  coloredText: {
    terminal_id: 'terminal_123',
    input: '\\x1b[31mRed Text\\x1b[0m',
    control_codes: true
  },
  
  // 上矢印キー（生バイト）
  upArrow: {
    terminal_id: 'terminal_123',
    input: '1b5b41',  // ESC[A
    raw_bytes: true
  },
  
  // Tab補完
  tabCompletion: {
    terminal_id: 'terminal_123',
    input: '\\t',
    control_codes: true
  }
};

console.log('MCP Shell Server - 制御コード送信機能');
console.log('=====================================');
console.log();
console.log('利用可能な制御コード例:');
console.log();

Object.entries(controlCodeExamples).forEach(([name, params]) => {
  console.log(`${name}:`);
  console.log(JSON.stringify(params, null, 2));
  console.log();
});

console.log('使用方法:');
console.log('1. ターミナルを作成: terminal_create');
console.log('2. 制御コード送信: terminal_input (上記パラメータを使用)');
console.log('3. 出力確認: terminal_output');
console.log();
console.log('注意: control_codes=true または raw_bytes=true を設定することで');
console.log('     制御コードの送信が有効になります。');
