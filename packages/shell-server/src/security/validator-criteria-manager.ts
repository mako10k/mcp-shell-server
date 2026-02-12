/**
 * UNUSED (2025-08-13)
 * This ValidatorCriteriaManager implementation is currently NOT referenced anywhere in the codebase.
 * Rationale: A parallel design was explored to separate validator-side criteria storage from the
 * generic criteria manager in `src/utils/criteria-manager.ts`. The active system now only uses the
 * util-based functions (adjustCriteria / loadCriteria, etc.).
 * We keep this file temporarily to preserve the concept of a future isolated validator process
 * that might require a distinct storage path & singleton lifecycle with backup introspection.
 * If this isolation is not implemented by a future release, this file should be deleted.
 *
 * To re-enable: import ValidatorCriteriaManager where validator-specific criteria loading is needed
 * and replace direct calls to util `adjustCriteria` with the class API.
 */
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/helpers.js';

/**
 * Validator-side criteria management for security evaluation
 * This manages criteria files that the Validator uses to evaluate commands
 * Separate from MCP client-side criteria management for security isolation
 */

export interface ValidatorCriteriaConfig {
  criteriaText: string;
  lastModified: Date;
  backupPath?: string | undefined;
}

export class ValidatorCriteriaManager {
  private static instance: ValidatorCriteriaManager;
  private readonly defaultCriteriaPath: string;
  private readonly backupDirectory: string;
  private currentCriteria: string | null = null;
  private lastFileModTime: number = 0;

  private constructor() {
    // Default path for validator criteria (separate from MCP client path)
    this.defaultCriteriaPath = process.env['VALIDATOR_CRITERIA_PATH'] || 
      '/tmp/mcp-shell-server/validator_criteria.txt';
    this.backupDirectory = path.dirname(this.defaultCriteriaPath) + '/criteria_backups';
    
    // Ensure directories exist
    this.ensureDirectoryExists(path.dirname(this.defaultCriteriaPath));
    this.ensureDirectoryExists(this.backupDirectory);
  }

  public static getInstance(): ValidatorCriteriaManager {
    if (!ValidatorCriteriaManager.instance) {
      ValidatorCriteriaManager.instance = new ValidatorCriteriaManager();
    }
    return ValidatorCriteriaManager.instance;
  }

  /**
   * Adjust validator criteria with backup support
   */
  public async adjustCriteria(criteriaText: string, backupExisting: boolean = true): Promise<{
    success: boolean;
    message: string;
    backupPath?: string;
  }> {
    try {
      let backupPath: string | undefined;

      // Create backup if requested and file exists
      if (backupExisting && fs.existsSync(this.defaultCriteriaPath)) {
        backupPath = await this.createBackup();
        logger.info('Validator criteria backup created', { backupPath });
      }

      // Write new criteria
      await fs.promises.writeFile(this.defaultCriteriaPath, criteriaText, 'utf-8');
      
      // Update cached criteria
      this.currentCriteria = criteriaText;
      this.lastFileModTime = Date.now();

      logger.info('Validator criteria updated successfully', {
        criteriaLength: criteriaText.length,
        backupCreated: !!backupPath
      });

      return {
        success: true,
        message: 'Validator criteria updated successfully',
        ...(backupPath && { backupPath })
      };
    } catch (error) {
      logger.error('Failed to adjust validator criteria', { error });
      return {
        success: false,
        message: `Failed to update criteria: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Load current criteria for validator use
   */
  public async loadCriteria(): Promise<string | null> {
    try {
      if (!fs.existsSync(this.defaultCriteriaPath)) {
        logger.debug('Validator criteria file not found, using default criteria');
        return null;
      }

      const fileStats = await fs.promises.stat(this.defaultCriteriaPath);
      const currentModTime = fileStats.mtime.getTime();

      // Reload if file was modified or not cached
      if (currentModTime !== this.lastFileModTime || this.currentCriteria === null) {
        this.currentCriteria = await fs.promises.readFile(this.defaultCriteriaPath, 'utf-8');
        this.lastFileModTime = currentModTime;
        logger.debug('Validator criteria loaded/refreshed', {
          criteriaLength: this.currentCriteria.length,
          lastModified: new Date(currentModTime).toISOString()
        });
      }

      return this.currentCriteria;
    } catch (error) {
      logger.error('Failed to load validator criteria', { error });
      return null;
    }
  }

  /**
   * Get current criteria configuration
   */
  public async getCriteriaConfig(): Promise<ValidatorCriteriaConfig | null> {
    try {
      if (!fs.existsSync(this.defaultCriteriaPath)) {
        return null;
      }

      const criteriaText = await this.loadCriteria();
      if (!criteriaText) {
        return null;
      }

      const fileStats = await fs.promises.stat(this.defaultCriteriaPath);
      
      return {
        criteriaText,
        lastModified: fileStats.mtime,
        ...(this.getLatestBackupPath() && { backupPath: this.getLatestBackupPath() })
      };
    } catch (error) {
      logger.error('Failed to get validator criteria config', { error });
      return null;
    }
  }

  private async createBackup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(this.backupDirectory, `validator_criteria_${timestamp}.txt`);
    
    await fs.promises.copyFile(this.defaultCriteriaPath, backupPath);
    return backupPath;
  }

  private getLatestBackupPath(): string | undefined {
    try {
      if (!fs.existsSync(this.backupDirectory)) {
        return undefined;
      }

      const backupFiles = fs.readdirSync(this.backupDirectory)
        .filter(file => file.startsWith('validator_criteria_') && file.endsWith('.txt'))
        .sort()
        .reverse();

      return backupFiles.length > 0 && backupFiles[0]
        ? path.join(this.backupDirectory, backupFiles[0])
        : undefined;
    } catch (error) {
      logger.warn('Failed to find latest backup', { error });
      return undefined;
    }
  }

  private ensureDirectoryExists(dirPath: string): void {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        logger.debug('Validator criteria directory created', { dirPath });
      }
    } catch (error) {
      logger.error('Failed to create validator criteria directory', { dirPath, error });
    }
  }

  /**
   * Get criteria file paths for debugging
   */
  public getCriteriaPaths(): {
    criteriaPath: string;
    backupDirectory: string;
    environmentVariable: string | undefined;
  } {
    return {
      criteriaPath: this.defaultCriteriaPath,
      backupDirectory: this.backupDirectory,
      environmentVariable: process.env['VALIDATOR_CRITERIA_PATH']
    };
  }
}
