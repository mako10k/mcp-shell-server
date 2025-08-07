import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { 
  ShellServerConfig, 
  ShellServerConfigSchema,
  EnhancedSecurityConfig,
  BasicSafetyRule,
  DEFAULT_ENHANCED_SECURITY_CONFIG,
  DEFAULT_BASIC_SAFETY_RULES 
} from '../types/enhanced-security.js';
import { getCurrentTimestamp } from '../utils/helpers.js';

/**
 * Configuration Manager for MCP Shell Server Enhanced Security
 * Handles loading, saving, and validating configuration files
 */
export class ConfigManager {
  private configPath: string;
  private config: ShellServerConfig;

  constructor(configPath?: string) {
    // Default config file path: $HOME/.mcp-shell-server/config.json
    this.configPath = configPath || this.getDefaultConfigPath();
    this.config = this.getDefaultConfig();
  }

  /**
   * Get default configuration file path
   */
  private getDefaultConfigPath(): string {
    const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '.';
    const configDir = path.join(homeDir, '.mcp-shell-server');
    return path.join(configDir, 'config.json');
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(): ShellServerConfig {
    return {
      server: {
        name: 'MCP Shell Server',
        version: '2.2.0',
      },
      enhanced_security: { ...DEFAULT_ENHANCED_SECURITY_CONFIG },
      basic_safety_rules: [...DEFAULT_BASIC_SAFETY_RULES],
    };
  }

  /**
   * Load configuration from file
   */
  async loadConfig(): Promise<ShellServerConfig> {
    try {
      // Check if config file exists
      await fs.access(this.configPath);
      
      // Read file content
      const configData = await fs.readFile(this.configPath, 'utf-8');
      const rawConfig = JSON.parse(configData);
      
      // Validate with Zod schema
      const validatedConfig = ShellServerConfigSchema.parse(rawConfig);
      
      this.config = validatedConfig;
      return this.config;
      
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Configuration validation failed: ${error.message}`);
      }
      
      // Return default config if file doesn't exist
      if ((error as any).code === 'ENOENT') {
        console.warn(`Configuration file not found at ${this.configPath}, using defaults`);
        await this.saveConfig(); // Create default config file
        return this.config;
      }
      
      throw new Error(`Failed to load configuration: ${error}`);
    }
  }

  /**
   * Save configuration to file
   */
  async saveConfig(config?: ShellServerConfig): Promise<void> {
    const configToSave = config || this.config;
    
    try {
      // Validate with Zod schema
      const validatedConfig = ShellServerConfigSchema.parse(configToSave);
      
      // Create directory if it doesn't exist
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });
      
      // Save to file (formatted JSON)
      const configJson = JSON.stringify(validatedConfig, null, 2);
      await fs.writeFile(this.configPath, configJson, 'utf-8');
      
      this.config = validatedConfig;
      
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Configuration validation failed: ${error.message}`);
      }
      throw new Error(`Failed to save configuration: ${error}`);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): ShellServerConfig {
    return { ...this.config };
  }

  /**
   * Get enhanced security configuration
   */
  getEnhancedSecurityConfig(): EnhancedSecurityConfig {
    return { ...this.config.enhanced_security || DEFAULT_ENHANCED_SECURITY_CONFIG };
  }

  /**
   * Update enhanced security configuration
   */
  async updateEnhancedSecurityConfig(
    updates: Partial<EnhancedSecurityConfig>, 
    saveToFile: boolean = true
  ): Promise<EnhancedSecurityConfig> {
    const currentConfig = this.getEnhancedSecurityConfig();
    const newConfig = { 
      ...currentConfig, 
      ...updates,
      safety_level_thresholds: {
        ...currentConfig.safety_level_thresholds,
        ...updates.safety_level_thresholds,
      }
    };
    
    this.config.enhanced_security = newConfig;
    
    if (saveToFile) {
      await this.saveConfig();
    }
    
    return newConfig;
  }

  /**
   * Get basic safety rules
   */
  getBasicSafetyRules(): BasicSafetyRule[] {
    return [...(this.config.basic_safety_rules || DEFAULT_BASIC_SAFETY_RULES)];
  }

  /**
   * Update basic safety rules
   */
  async updateBasicSafetyRules(rules: BasicSafetyRule[], saveToFile: boolean = true): Promise<void> {
    this.config.basic_safety_rules = [...rules];
    
    if (saveToFile) {
      await this.saveConfig();
    }
  }

  /**
   * Get configuration file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Reset configuration to defaults
   */
  async resetToDefaults(saveToFile: boolean = true): Promise<ShellServerConfig> {
    this.config = this.getDefaultConfig();
    
    if (saveToFile) {
      await this.saveConfig();
    }
    
    return this.config;
  }

  /**
   * Create backup of current configuration
   */
  async createBackup(): Promise<string> {
    const timestamp = getCurrentTimestamp().replace(/[:.]/g, '-');
    const backupPath = `${this.configPath}.backup.${timestamp}`;
    
    try {
      await fs.copyFile(this.configPath, backupPath);
      return backupPath;
    } catch (error) {
      throw new Error(`Failed to create backup: ${error}`);
    }
  }

  /**
   * Get configuration file statistics
   */
  async getConfigStats(): Promise<{
    exists: boolean;
    size: number;
    lastModified: Date | null;
    path: string;
  }> {
    try {
      const stats = await fs.stat(this.configPath);
      return {
        exists: true,
        size: stats.size,
        lastModified: stats.mtime,
        path: this.configPath,
      };
    } catch (error) {
      return {
        exists: false,
        size: 0,
        lastModified: null,
        path: this.configPath,
      };
    }
  }

  /**
   * Validate configuration object
   */
  validateConfig(config: unknown): ShellServerConfig {
    return ShellServerConfigSchema.parse(config);
  }
}

// Singleton instance (optional)
let globalConfigManager: ConfigManager | null = null;

/**
 * Get global configuration manager instance
 */
export function getGlobalConfigManager(configPath?: string): ConfigManager {
  if (!globalConfigManager) {
    globalConfigManager = new ConfigManager(configPath);
  }
  return globalConfigManager;
}
