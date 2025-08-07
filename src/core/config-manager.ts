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
 * Enhanced Security設定ファイル管理クラス
 * 設定の読み込み、保存、バリデーションを担当
 */
export class ConfigManager {
  private configPath: string;
  private config: ShellServerConfig;

  constructor(configPath?: string) {
    // デフォルト設定ファイルパス: $HOME/.mcp-shell-server/config.json
    this.configPath = configPath || this.getDefaultConfigPath();
    this.config = this.getDefaultConfig();
  }

  /**
   * デフォルト設定ファイルパスを取得
   */
  private getDefaultConfigPath(): string {
    const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '.';
    const configDir = path.join(homeDir, '.mcp-shell-server');
    return path.join(configDir, 'config.json');
  }

  /**
   * デフォルト設定を取得
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
   * 設定ファイルを読み込み
   */
  async loadConfig(): Promise<ShellServerConfig> {
    try {
      // 設定ファイルの存在確認
      await fs.access(this.configPath);
      
      // ファイル読み込み
      const configData = await fs.readFile(this.configPath, 'utf-8');
      const rawConfig = JSON.parse(configData);
      
      // Zodスキーマでバリデーション
      const validatedConfig = ShellServerConfigSchema.parse(rawConfig);
      
      this.config = validatedConfig;
      return this.config;
      
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Configuration validation failed: ${error.message}`);
      }
      
      // ファイルが存在しない場合はデフォルト設定を返す
      if ((error as any).code === 'ENOENT') {
        console.warn(`Configuration file not found at ${this.configPath}, using defaults`);
        return this.config;
      }
      
      throw new Error(`Failed to load configuration: ${error}`);
    }
  }

  /**
   * 設定ファイルを保存
   */
  async saveConfig(config?: ShellServerConfig): Promise<void> {
    const configToSave = config || this.config;
    
    try {
      // Zodスキーマでバリデーション
      const validatedConfig = ShellServerConfigSchema.parse(configToSave);
      
      // ディレクトリが存在しない場合は作成
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });
      
      // ファイルに保存（整形済みJSON）
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
   * 現在の設定を取得
   */
  getConfig(): ShellServerConfig {
    return { ...this.config };
  }

  /**
   * Enhanced Security設定を取得
   */
  getEnhancedSecurityConfig(): EnhancedSecurityConfig {
    return { ...this.config.enhanced_security || DEFAULT_ENHANCED_SECURITY_CONFIG };
  }

  /**
   * Enhanced Security設定を更新
   */
  updateEnhancedSecurityConfig(updates: Partial<EnhancedSecurityConfig>): EnhancedSecurityConfig {
    const currentConfig = this.getEnhancedSecurityConfig();
    const newConfig = { ...currentConfig, ...updates };
    
    this.config.enhanced_security = newConfig;
    return newConfig;
  }

  /**
   * 基本安全ルールを取得
   */
  getBasicSafetyRules(): BasicSafetyRule[] {
    return [...(this.config.basic_safety_rules || DEFAULT_BASIC_SAFETY_RULES)];
  }

  /**
   * 基本安全ルールを更新
   */
  updateBasicSafetyRules(rules: BasicSafetyRule[]): void {
    this.config.basic_safety_rules = [...rules];
  }

  /**
   * 設定ファイルパスを取得
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * 設定をリセット（デフォルトに戻す）
   */
  resetToDefaults(): ShellServerConfig {
    this.config = this.getDefaultConfig();
    return this.config;
  }

  /**
   * 設定のバックアップを作成
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
   * 設定ファイルの統計情報を取得
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
}

// シングルトンインスタンス（オプション）
let globalConfigManager: ConfigManager | null = null;

/**
 * グローバル設定マネージャーのインスタンスを取得
 */
export function getGlobalConfigManager(configPath?: string): ConfigManager {
  if (!globalConfigManager) {
    globalConfigManager = new ConfigManager(configPath);
  }
  return globalConfigManager;
}
