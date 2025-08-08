#!/usr/bin/env node

// Test elicitation system
console.log('Starting MCP Shell Server elicitation test...');

import { spawn } from 'child_process';
import * as path from 'path';

const serverPath = path.resolve('./dist/index.js');

console.log('Server path:', serverPath);

// Start the server
const server = spawn('node', [serverPath], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    MCP_SHELL_SECURITY_MODE: 'enhanced',
    MCP_SHELL_ELICITATION: 'true',
    NODE_ENV: 'development'
  }
});

server.stdout.on('data', (data) => {
  console.log('SERVER OUT:', data.toString());
});

server.stderr.on('data', (data) => {
  console.log('SERVER ERR:', data.toString());
});

server.on('close', (code) => {
  console.log(`Server exited with code ${code}`);
});

// Keep test running for 15 seconds
setTimeout(() => {
  console.log('Stopping test server...');
  server.kill();
}, 15000);
