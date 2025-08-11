#!/usr/bin/env node
import { ShellTools } from './dist/tools/shell-tools.js';
import { SecurityManager } from './dist/security/manager.js';
import { ConfigManager } from './dist/core/config-manager.js';
import { CommandHistoryManager } from './dist/core/enhanced-history-manager.js';
import { ProcessManager } from './dist/core/process-manager.js';
import { FileManager } from './dist/core/file-manager.js';

async function testForceUserConfirm() {
  console.log('Testing force_user_confirm functionality...');
  
  try {
    // Initialize managers
    const configManager = new ConfigManager();
    const fileManager = new FileManager();
    const processManager = new ProcessManager(50, '/tmp/mcp-shell-outputs', fileManager);
    const enhancedConfig = configManager.getEnhancedSecurityConfig();
    const commandHistoryManager = new CommandHistoryManager(enhancedConfig);
    
    // Create SecurityManager with default configuration
    const securityManager = new SecurityManager();
    
    // Initialize Enhanced Safety Evaluator with mock server
    const mockServer = {
      request: async (params) => {
        console.log('Mock MCP request:', JSON.stringify(params, null, 2));
        return {
          content: {
            type: 'text',
            text: JSON.stringify({
              evaluation_result: 'ALLOW',
              reasoning: 'Simple echo command is safe',
              basic_classification: 'basic_safe',
              requires_additional_context: null
            })
          }
        };
      }
    };
    
    securityManager.initializeEnhancedEvaluator(commandHistoryManager, mockServer);
    
    // Create ShellTools instance with correct parameter order
    const shellTools = new ShellTools(
      processManager,
      // terminalManager (we need to create one)
      new (await import('./dist/core/terminal-manager.js')).TerminalManager(),
      fileManager,
      // monitoringManager (we need to create one)
      new (await import('./dist/core/monitoring-manager.js')).MonitoringManager(),
      securityManager,
      commandHistoryManager
    );
    
    // Test force_user_confirm
    console.log('\n--- Testing with force_user_confirm: true ---');
    
    const result = await shellTools.executeShell({
      command: 'echo "Hello World"',
      force_user_confirm: true,
      working_directory: process.cwd()
    });
    
    console.log('Result:', JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

testForceUserConfirm();
