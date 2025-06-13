#!/usr/bin/env node

// 新しいターミナル作成機能のテスト
import { spawn } from 'child_process';

console.log('🧪 Testing new terminal creation feature via shell_execute...');

const serverProcess = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let responseData = '';

// サーバーからのレスポンスを受信
serverProcess.stdout.on('data', (data) => {
  responseData += data.toString();
});

serverProcess.stderr.on('data', (data) => {
  console.error('Server error:', data.toString());
});

// MCPリクエストの送信
const sendMCPRequest = (method, params) => {
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: method,
    params: params
  };
  
  const requestStr = JSON.stringify(request) + '\n';
  serverProcess.stdin.write(requestStr);
};

setTimeout(() => {
  console.log('📤 Sending initialize request...');
  
  // 初期化リクエスト
  sendMCPRequest('initialize', {
    protocolVersion: "2024-11-05",
    capabilities: {
      tools: {}
    },
    clientInfo: {
      name: "test-client",
      version: "1.0.0"
    }
  });
  
  setTimeout(() => {
    console.log('📤 Sending terminal creation request...');
    
    // ターミナル作成リクエスト
    sendMCPRequest('tools/call', {
      name: 'shell_execute',
      arguments: {
        command: 'echo "Hello from new terminal!"',
        create_terminal: true,
        terminal_shell: 'bash',
        terminal_dimensions: {
          width: 80,
          height: 24
        }
      }
    });
    
    setTimeout(() => {
      console.log('📊 Response received:');
      console.log(responseData);
      
      serverProcess.kill('SIGTERM');
      
      if (responseData.includes('terminal_id')) {
        console.log('✅ SUCCESS: Terminal creation feature is working!');
        process.exit(0);
      } else {
        console.log('❌ Terminal creation may not be working as expected');
        process.exit(1);
      }
    }, 2000);
  }, 1000);
}, 500);

serverProcess.on('error', (error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
