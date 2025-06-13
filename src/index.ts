#!/usr/bin/env node

import { MCPShellServer } from './server.js';
import { logger } from './utils/helpers.js';

async function main() {
  const server = new MCPShellServer();
  
  // グレースフルシャットダウンの設定
  const cleanup = async () => {
    // console.error('Shutting down MCP Shell Server...');
    logger.info('Shutting down MCP Shell Server', {}, 'main');
    await server.cleanup();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('uncaughtException', (error) => {
    // console.error('Uncaught Exception:', error);
    logger.error('Uncaught Exception', { error: error.message, stack: error.stack }, 'main');
    cleanup();
  });
  process.on('unhandledRejection', (reason, promise) => {
    // console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    logger.error('Unhandled Rejection', { reason, promise: promise.toString() }, 'main');
    cleanup();
  });

  try {
    await server.run();
  } catch (error) {
    // console.error('Failed to start MCP Shell Server:', error);
    logger.error('Failed to start MCP Shell Server', { error: String(error) }, 'main');
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    // console.error('Fatal error:', error);
    logger.error('Fatal error', { error: String(error) }, 'main');
    process.exit(1);
  });
}
