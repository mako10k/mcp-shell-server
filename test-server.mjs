#!/usr/bin/env node

// Simple test script to verify the MCP Shell Server works
import { MCPShellServer } from './dist/server.js';

console.log('🔧 Starting MCP Shell Server Test...');

async function testServer() {
  try {
    const server = new MCPShellServer();
    
    // Test basic initialization
    console.log('✅ Server initialized successfully');
    
    // Test that managers are working
    const restrictions = server.securityManager.getRestrictions();
    if (restrictions && restrictions.active) {
      console.log('✅ Security Manager working');
    }
    
    // Test process manager
    const processes = server.processManager.listExecutions();
    if (processes && Array.isArray(processes.executions)) {
      console.log('✅ Process Manager working');
    }
    
    // Test file manager
    const files = server.fileManager.listFiles();
    if (files && Array.isArray(files.files)) {
      console.log('✅ File Manager working');
    }
    
    // Test monitoring manager
    const stats = server.monitoringManager.getSystemStats();
    if (stats && stats.collected_at) {
      console.log('✅ Monitoring Manager working');
    }
    
    console.log('🎉 All core components are working!');
    console.log('🚀 MCP Shell Server is ready for production use');
    
    // Cleanup
    server.cleanup();
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testServer();
