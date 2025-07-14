#!/usr/bin/env node

import { MCPShellServer } from './dist/server.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

async function testTimeout() {
  console.log('Testing timeout functionality...');
  
  // Create a test server instance
  const server = new MCPShellServer();
  
  try {
    // Test the timeout functionality directly
    console.log('Testing shell_execute with return_partial_on_timeout...');
    
    const params = {
      command: 'sleep 30',
      execution_mode: 'foreground',
      timeout_seconds: 5,
      return_partial_on_timeout: true
    };
    
    const result = await server.shellTools.executeShell(params);
    console.log('Result:', JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  }
  
  process.exit(0);
}

testTimeout();
