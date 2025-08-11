// History機能とログ分析のテスト
import { logger } from './dist/utils/helpers.js';

console.log('=== Log History Analysis Test ===\n');

// 1. 全ログエントリ統計
const stats = logger.getStats();
console.log('📊 Log Statistics:');
console.log(`  Total Entries: ${stats.totalEntries}`);
console.log(`  By Level:`, stats.byLevel);
console.log(`  By Component:`, stats.byComponent);
console.log(`  Time Range: ${stats.oldestEntry} to ${stats.newestEntry}\n`);

// 2. Function Call コンポーネントのログのみ取得
const functionCallLogs = logger.getHistory({ component: 'function-call' });
console.log('🔧 Function Call Logs:');
functionCallLogs.forEach((entry, index) => {
  console.log(`  ${index + 1}. [${entry.level}] ${entry.message}`);
  if (entry.data) {
    console.log(`     Data: ${JSON.stringify(entry.data, null, 2).substring(0, 200)}...`);
  }
});
console.log('');

// 3. エラーレベル以上のログのみ取得
const errorLogs = logger.getHistory({ level: 3 }); // ERROR = 3
console.log('❌ Error Level Logs:');
errorLogs.forEach((entry, index) => {
  console.log(`  ${index + 1}. ${entry.timestamp} - ${entry.message}`);
});
console.log('');

// 4. 特定の検索語でログを検索
const searchResults = logger.getHistory({ search: 'security' });
console.log('🔍 Search Results for "security":');
searchResults.forEach((entry, index) => {
  console.log(`  ${index + 1}. ${entry.message}`);
});
console.log('');

// 5. 最新の5つのログ
const recentLogs = logger.getHistory({ limit: 5 });
console.log('⏰ Recent 5 Logs:');
recentLogs.forEach((entry, index) => {
  console.log(`  ${index + 1}. [${entry.component || 'SYSTEM'}] ${entry.message}`);
});
console.log('');

// 6. ファイルから直接ログを読み取り
console.log('📁 Reading from log file:');
try {
  const fileLines = await logger.readLogFile(3);
  console.log('Last 3 lines from file:');
  fileLines.forEach((line, index) => {
    console.log(`  ${index + 1}. ${line}`);
  });
} catch (error) {
  console.log('Error reading log file:', error.message);
}

console.log('\n=== Test Completed ===');
