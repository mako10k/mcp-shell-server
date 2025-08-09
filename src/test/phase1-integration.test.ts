import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { SecurityManager } from '../security/manager.js';
import { ConfigManager } from '../core/config-manager.js';
import { CommandHistoryManager } from '../core/enhanced-history-manager.js';
import { 
  DEFAULT_ENHANCED_SECURITY_CONFIG,
  DEFAULT_BASIC_SAFETY_RULES,
  CommandClassification 
} from '../types/enhanced-security.js';

describe('Phase 1 Integration Tests', () => {
  let securityManager: SecurityManager;
  let configManager: ConfigManager;
  let historyManager: CommandHistoryManager;
  let tempDir: string;
  let configPath: string;
  let historyPath: string;

  beforeEach(async () => {
    // Create temporary directory for test files
    tempDir = path.join(__dirname, 'temp-test-' + Date.now());
    await fs.mkdir(tempDir, { recursive: true });
    
    configPath = path.join(tempDir, 'test-config.json');
    historyPath = path.join(tempDir, 'test-history.json');
    
    // Initialize managers
    securityManager = new SecurityManager();
    configManager = new ConfigManager(configPath);
    historyManager = new CommandHistoryManager(DEFAULT_ENHANCED_SECURITY_CONFIG, historyPath);
  });

  afterEach(async () => {
    // Cleanup temporary files
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('SecurityManager Enhanced Features', () => {
    it('should classify basic safe commands correctly', () => {
      const testCases = [
        { command: 'ls -la', expectedClassification: 'basic_safe' },
        { command: 'pwd', expectedClassification: 'basic_safe' },
        { command: 'cat README.md', expectedClassification: 'basic_safe' },
        { command: 'rm -rf /', expectedClassification: 'llm_required' },
        { command: 'sudo something', expectedClassification: 'llm_required' },
        { command: 'unknown-command', expectedClassification: 'llm_required' },
      ];

      testCases.forEach(({ command, expectedClassification }) => {
        const result = securityManager.classifyCommandSafety(command);
        expect(result).toBe(expectedClassification as CommandClassification);
      });
    });

    it('should provide detailed safety analysis', () => {
      const analysis = securityManager.analyzeCommandSafety('ls -la');
      
      expect(analysis).toHaveProperty('classification');
      expect(analysis).toHaveProperty('reasoning');
      expect(analysis).toHaveProperty('safety_level');
      expect(analysis.classification).toBe('basic_safe');
      expect(analysis.reasoning).toBeTruthy();
      expect(analysis.safety_level).toBeLessThanOrEqual(3);
    });

    it('should handle enhanced security configuration', () => {
      expect(securityManager.isEnhancedModeEnabled()).toBe(false);
      expect(securityManager.isLLMEvaluationEnabled()).toBe(false);
      expect(securityManager.isCommandHistoryEnhanced()).toBe(true);
      
      securityManager.setEnhancedConfig({
        enhanced_mode_enabled: true,
        llm_evaluation_enabled: true,
      });
      
      expect(securityManager.isEnhancedModeEnabled()).toBe(true);
      expect(securityManager.isLLMEvaluationEnabled()).toBe(true);
    });

    it('should manage basic safety rules', () => {
      const initialRules = securityManager.getBasicSafetyRules();
      expect(initialRules).toEqual(DEFAULT_BASIC_SAFETY_RULES);
      
      const customRules = [
        { pattern: '^test.*', reasoning: 'Test commands', safety_level: 1 }
      ];
      
      securityManager.setBasicSafetyRules(customRules);
      expect(securityManager.getBasicSafetyRules()).toEqual(customRules);
    });
  });

  describe('ConfigManager Integration', () => {
    it('should create and load default configuration', async () => {
      // Initially config file doesn't exist
      expect(await configManager.configExists()).toBe(false);
      
      // Load config should create default file
      const config = await configManager.loadConfig();
      expect(config).toBeDefined();
      expect(config.enhanced_security).toBeDefined();
      expect(config.basic_safety_rules).toBeDefined();
      
      // Config file should now exist
      expect(await configManager.configExists()).toBe(true);
    });

    it('should update and save enhanced security config', async () => {
      await configManager.loadConfig();
      
      const updates = {
        enhanced_mode_enabled: true,
        llm_evaluation_enabled: true,
        history_retention_days: 60,
      };
      
      const updatedConfig = await configManager.updateEnhancedSecurityConfig(updates, true);
      
      expect(updatedConfig.enhanced_mode_enabled).toBe(true);
      expect(updatedConfig.llm_evaluation_enabled).toBe(true);
      expect(updatedConfig.history_retention_days).toBe(60);
      
      // Reload from file to verify persistence
      const reloadedConfig = await configManager.loadConfig();
      expect(reloadedConfig.enhanced_security?.enhanced_mode_enabled).toBe(true);
      expect(reloadedConfig.enhanced_security?.llm_evaluation_enabled).toBe(true);
      expect(reloadedConfig.enhanced_security?.history_retention_days).toBe(60);
    });

    it('should handle configuration validation', () => {
      const invalidConfig = {
        enhanced_security: {
          enhanced_mode_enabled: 'invalid', // Should be boolean
          history_retention_days: -1, // Should be positive
        }
      };
      
      expect(() => configManager.validateConfig(invalidConfig)).toThrow();
    });

    it('should create backups', async () => {
      await configManager.loadConfig();
      await configManager.saveConfig();
      
      const backupPath = await configManager.createBackup();
      expect(backupPath).toContain('.backup.');
      
      // Verify backup file exists
      const backupExists = await fs.access(backupPath).then(() => true).catch(() => false);
      expect(backupExists).toBe(true);
    });
  });

  describe('CommandHistoryManager Integration', () => {
    it('should add and retrieve history entries', async () => {
      const entry = {
        command: 'ls -la',
        working_directory: '/test',
        safety_classification: 'basic_safe' as const,
        was_executed: true,
        resubmission_count: 0,
      };
      
      const executionId = await historyManager.addHistoryEntry(entry);
      expect(executionId).toBeTruthy();
      
      const history = historyManager.searchHistory({ command: 'ls' });
      expect(history).toHaveLength(1);
      expect(history[0]?.command).toBe('ls -la');
      expect(history[0]?.execution_id).toBe(executionId);
    });

    it('should find similar commands', async () => {
      const commands = ['ls -la', 'ls -l', 'cat file.txt', 'grep pattern file.txt'];
      
      // Add multiple history entries
      for (const command of commands) {
        await historyManager.addHistoryEntry({
          command,
          working_directory: '/test',
          was_executed: true,
          resubmission_count: 0,
        });
      }
      
      const similarToLs = historyManager.findSimilarCommands('ls');
      expect(similarToLs.length).toBeGreaterThanOrEqual(2);
      expect(similarToLs.some(entry => entry.command === 'ls -la')).toBe(true);
      expect(similarToLs.some(entry => entry.command === 'ls -l')).toBe(true);
    });

    it('should learn user confirmation patterns', async () => {
      const entry = {
        command: 'rm file.txt',
        working_directory: '/test',
        was_executed: true,
        resubmission_count: 0,
        user_confirmation_context: {
          prompt: 'Are you sure you want to delete file.txt?',
          user_response: true,
          user_reasoning: 'File is no longer needed',
          timestamp: new Date().toISOString(),
          confidence_level: 5,
        },
      };
      
      await historyManager.addHistoryEntry(entry);
      historyManager.learnUserConfirmationPattern(entry);
      
      const prediction = historyManager.predictUserConfirmation('rm another-file.txt');
      expect(prediction.likely_to_confirm).toBeDefined();
      expect(prediction.confidence).toBeGreaterThan(0);
    });

    it('should get history statistics', async () => {
      // Add some test entries
      const entries = [
        { command: 'ls', working_directory: '/test', was_executed: true, resubmission_count: 0 },
        { command: 'cat file', working_directory: '/test', was_executed: true, resubmission_count: 0 },
        { command: 'ls -la', working_directory: '/test', was_executed: false, resubmission_count: 1 },
      ];
      
      for (const entry of entries) {
        await historyManager.addHistoryEntry(entry);
      }
      
      const stats = historyManager.getHistoryStats();
      expect(stats.totalEntries).toBe(3);
      expect(stats.topCommands).toBeDefined();
      expect(stats.topCommands.length).toBeGreaterThan(0);
      expect(stats.topCommands[0]?.command).toBe('ls'); // Most frequent
    });

    it('should save and load history from file', async () => {
      const entry = {
        command: 'test command',
        working_directory: '/test',
        was_executed: true,
        resubmission_count: 0,
      };
      
      await historyManager.addHistoryEntry(entry);
      await historyManager.saveHistory();
      
      // Create new history manager and load from file
      const newHistoryManager = new CommandHistoryManager(DEFAULT_ENHANCED_SECURITY_CONFIG, historyPath);
      await newHistoryManager.loadHistory();
      
      const loadedHistory = newHistoryManager.searchHistory({ command: 'test' });
      expect(loadedHistory).toHaveLength(1);
      expect(loadedHistory[0]?.command).toBe('test command');
    });
  });

  describe('Cross-Component Integration', () => {
    it('should integrate SecurityManager with ConfigManager', async () => {
      // Load config and update security manager
      const config = await configManager.loadConfig();
      if (config.enhanced_security) {
        securityManager.setEnhancedConfig(config.enhanced_security);
      }
      if (config.basic_safety_rules) {
        securityManager.setBasicSafetyRules(config.basic_safety_rules);
      }
      
      // Test classification with loaded config
      const classification = securityManager.classifyCommandSafety('ls -la');
      expect(classification).toBe('basic_safe');
      
      // Update config and verify security manager behavior
      await configManager.updateEnhancedSecurityConfig({ basic_safe_classification: false });
      const updatedConfig = configManager.getEnhancedSecurityConfig();
      securityManager.setEnhancedConfig(updatedConfig);
      
      const newClassification = securityManager.classifyCommandSafety('ls -la');
      expect(newClassification).toBe('llm_required'); // Should require LLM when basic classification is disabled
    });

    it('should integrate SecurityManager with CommandHistoryManager', async () => {
      // Classify command and add to history
      const command = 'cat README.md';
      const analysis = securityManager.analyzeCommandSafety(command);
      
      const historyEntry = {
        command,
        working_directory: '/test',
        safety_classification: analysis.classification,
        was_executed: true,
        resubmission_count: 0,
      };
      
      const executionId = await historyManager.addHistoryEntry(historyEntry);
      
      // Update history with additional evaluation results
      await historyManager.updateHistoryEntry(executionId, {
        evaluation_reasoning: analysis.reasoning,
      });
      
      const retrievedHistory = historyManager.searchHistory({ command: 'cat' });
      expect(retrievedHistory).toHaveLength(1);
      expect(retrievedHistory[0]?.safety_classification).toBe(analysis.classification);
      expect(retrievedHistory[0]?.evaluation_reasoning).toBe(analysis.reasoning);
    });
  });
});
