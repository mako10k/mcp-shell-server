import { TerminalManager } from '../src/core/terminal-manager.js';
import { ShellType } from '../src/types/index.js';

// テスト用の簡単なスクリプト
async function testControlCodes() {
  const terminalManager = new TerminalManager();
  
  try {
    // ターミナルを作成
    const terminal = await terminalManager.createTerminal({
      shellType: 'bash',
      dimensions: { cols: 80, rows: 24 },
      autoSaveHistory: true
    });

    console.log('Terminal created:', terminal.id);

    // 基本的なコマンドを送信
    console.log('\n=== 通常の入力テスト ===');
    let result = terminalManager.sendInput(terminal.id, 'echo "Hello World"', true);
    console.log('Result:', result);

    // 制御コードテスト
    console.log('\n=== 制御コードテスト ===');
    
    // Ctrl+C を送信
    result = terminalManager.sendInput(terminal.id, '^C', false, true);
    console.log('Ctrl+C sent:', result);

    // ESCキーを送信
    result = terminalManager.sendInput(terminal.id, '\\x1b', false, true);
    console.log('ESC key sent:', result);

    // 16進数エスケープでCtrl+Cを送信
    result = terminalManager.sendInput(terminal.id, '\\x03', false, true);
    console.log('Ctrl+C (hex) sent:', result);

    // 生バイトテスト
    console.log('\n=== 生バイトテスト ===');
    
    // ESC[A (上矢印キー) を送信
    result = terminalManager.sendInput(terminal.id, '1b5b41', false, false, true);
    console.log('Up arrow (raw bytes) sent:', result);

    // 少し待ってから出力を取得
    setTimeout(() => {
      const output = terminalManager.getOutput(terminal.id);
      console.log('\n=== ターミナル出力 ===');
      console.log(output);
      
      // ターミナルを閉じる
      terminalManager.closeTerminal(terminal.id);
      console.log('\nTerminal closed');
    }, 1000);

  } catch (error) {
    console.error('Error:', error);
  }
}

testControlCodes();
