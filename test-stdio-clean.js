#!/usr/bin/env node

// STDIO出力のクリーンさをテストするスクリプト
// このスクリプトはMCPサーバーを短時間実行して、不要な出力がないかチェックします

import { spawn } from 'child_process';
import fs from 'fs';

console.log('🧪 Testing STDIO output cleanliness...');

// ビルドされたサーバーを実行
const serverProcess = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let stdoutData = '';
let stderrData = '';

// 標準出力をキャプチャ
serverProcess.stdout.on('data', (data) => {
  stdoutData += data.toString();
});

// 標準エラー出力をキャプチャ
serverProcess.stderr.on('data', (data) => {
  stderrData += data.toString();
});

// 2秒後にプロセスを終了
setTimeout(() => {
  serverProcess.kill('SIGTERM');
  
  setTimeout(() => {
    console.log('\n📊 STDIO Output Analysis:');
    console.log('='.repeat(50));
    
    console.log(`📤 STDOUT length: ${stdoutData.length} characters`);
    if (stdoutData.length > 0) {
      console.log('⚠️  STDOUT content (first 200 chars):');
      console.log(JSON.stringify(stdoutData.substring(0, 200)));
    } else {
      console.log('✅ STDOUT is clean (no output)');
    }
    
    console.log(`\n📤 STDERR length: ${stderrData.length} characters`);
    if (stderrData.length > 0) {
      console.log('⚠️  STDERR content (first 200 chars):');
      console.log(JSON.stringify(stderrData.substring(0, 200)));
    } else {
      console.log('✅ STDERR is clean (no output)');
    }
    
    console.log('\n🎯 Result:');
    if (stdoutData.length === 0) {
      console.log('✅ SUCCESS: STDOUT is clean - MCP STDIO transport will work correctly');
    } else {
      console.log('❌ FAILURE: STDOUT contains output - MCP STDIO transport may not work');
    }
    
    if (stderrData.length === 0) {
      console.log('✅ SUCCESS: STDERR is clean - No error noise');
    } else {
      console.log('⚠️  WARNING: STDERR contains output - Check for unwanted error messages');
    }
    
    process.exit(stdoutData.length === 0 ? 0 : 1);
  }, 1000);
}, 2000);

serverProcess.on('error', (error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
