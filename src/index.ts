#!/usr/bin/env node

import { MCPShellServer } from './server.js';

async function main() {
  const server = new MCPShellServer();
  
  // グレースフルシャットダウンの設定
  const cleanup = async () => {
    console.error('Shutting down MCP Shell Server...');
    await server.cleanup();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    cleanup();
  });
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    cleanup();
  });

  try {
    await server.run();
  } catch (error) {
    console.error('Failed to start MCP Shell Server:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
