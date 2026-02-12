import fs from 'fs/promises';
import path from 'path';
import { logger } from './helpers.js';

/**
 * Default security criteria content
 */
const DEFAULT_CRITERIA = `
## Security Evaluation Criteria

### Primary Goal
Prevent reckless, careless, or commands that deviate from user intent.

### Evaluation Guidelines
- **Reckless**: Commands with destructive potential without clear purpose
- **Careless**: Commands that could cause unintended side effects  
- **Intent Deviation**: Commands that don't align with established user workflow patterns

### Tool Selection Guidelines
- **allow()**: Default for routine development operations (builds, tests, file operations in project context)
- **ai_assistant_confirm()**: Only when genuinely missing critical information
- **user_confirm()**: For commands with legitimate risk but valid use cases
- **deny()**: For clearly destructive or malicious commands

### Context Awareness
Consider command history and established workflow patterns when evaluating commands.
Match evaluation strictness to actual risk level and maintain development-friendly approach.
`.trim();

/**
 * Configuration for criteria file management
 */
export interface CriteriaConfig {
  filePath: string;
  backupDir: string;
  defaultContent: string;
}

/**
 * Get criteria file configuration from environment or defaults
 */
export function getCriteriaConfig(): CriteriaConfig {
  const defaultPath = process.env['MCP_VALIDATION_CRITERIA_PATH'] || 
    path.join('/tmp', 'mcp-shell-server', 'validation_criteria.txt');
  
  return {
    filePath: defaultPath,
    backupDir: path.join(path.dirname(defaultPath), 'backups'),
    defaultContent: DEFAULT_CRITERIA,
  };
}

/**
 * Ensure directory exists, creating if necessary
 */
async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

/**
 * Create timestamped backup of existing criteria file
 */
async function createBackup(config: CriteriaConfig): Promise<string | null> {
  try {
    const content = await fs.readFile(config.filePath, 'utf8');
    await ensureDirectory(config.backupDir);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(config.backupDir, `criteria_${timestamp}.txt`);
    
    await fs.writeFile(backupPath, content, 'utf8');
    return backupPath;
  } catch (error) {
    // If original file doesn't exist, no backup needed
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Load security criteria from file
 */
export async function loadCriteria(): Promise<string> {
  const config = getCriteriaConfig();
  
  try {
    const content = await fs.readFile(config.filePath, 'utf8');
    return content.trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist, return default criteria
      return config.defaultContent;
    }
    throw error;
  }
}

/**
 * Save security criteria to file
 */
export async function saveCriteria(
  criteriaText: string,
  appendMode = false,
  backupExisting = true
): Promise<{ backupPath: string | null; criteriaPath: string }> {
  const config = getCriteriaConfig();
  
  // Validate criteria text
  const trimmedCriteria = criteriaText.trim();
  if (!trimmedCriteria) {
    throw new Error('Criteria text cannot be empty');
  }
  
  // Ensure directory exists
  await ensureDirectory(path.dirname(config.filePath));
  
  // Create backup if requested and file exists
  let backupPath: string | null = null;
  if (backupExisting) {
    backupPath = await createBackup(config);
  }
  
  // Prepare content
  let finalContent: string;
  if (appendMode) {
    try {
      const existingContent = await fs.readFile(config.filePath, 'utf8');
      finalContent = `${existingContent.trim()}\n\n${trimmedCriteria}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist, just use new content
        finalContent = trimmedCriteria;
      } else {
        throw error;
      }
    }
  } else {
    finalContent = trimmedCriteria;
  }
  
  // Save criteria
  await fs.writeFile(config.filePath, finalContent, 'utf8');
  
  return {
    backupPath,
    criteriaPath: config.filePath,
  };
}

/**
 * Check if criteria file was modified since last read
 */
export async function isCriteriaModified(lastModified: Date): Promise<boolean> {
  const config = getCriteriaConfig();
  
  try {
    const stats = await fs.stat(config.filePath);
    return stats.mtime > lastModified;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false; // File doesn't exist
    }
    throw error;
  }
}

/**
 * Get criteria file status information
 */
export async function getCriteriaStatus(): Promise<{
  exists: boolean;
  path: string;
  lastModified?: Date;
  size?: number;
}> {
  const config = getCriteriaConfig();
  
  try {
    const stats = await fs.stat(config.filePath);
    return {
      exists: true,
      path: config.filePath,
      lastModified: stats.mtime,
      size: stats.size,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        exists: false,
        path: config.filePath,
      };
    }
    throw error;
  }
}

/**
 * Adjust security evaluation criteria dynamically
 * Used by both MCP tools and internal validator functions
 */
export async function adjustCriteria(
  criteriaText: string,
  appendMode: boolean = false,
  backupExisting: boolean = true
): Promise<{
  success: boolean;
  message: string;
  backupPath?: string;
  criteriaPath: string;
}> {
  const config = getCriteriaConfig();
  
  try {
    // Create backup if requested and file exists
    let backupPath: string | undefined;
    if (backupExisting) {
      try {
        const existing = await loadCriteria();
        if (existing && existing.trim()) {
          const backup = await createBackup(config);
          backupPath = backup || undefined;
        }
      } catch (error) {
        // Backup failed but continue with criteria update
        logger.warn('Failed to create backup before criteria adjustment', { error });
      }
    }
    
    // Prepare new content
    let newContent: string;
    if (appendMode) {
      try {
        const existing = await loadCriteria();
        newContent = existing ? `${existing}\n\n${criteriaText}` : criteriaText;
      } catch (error) {
        // If loading fails, treat as new content
        newContent = criteriaText;
      }
    } else {
      newContent = criteriaText;
    }
    
    // Save new criteria
    await saveCriteria(newContent);
    
    return {
      success: true,
      message: appendMode ? 'Criteria successfully appended' : 'Criteria successfully updated',
      ...(backupPath && { backupPath }),
      criteriaPath: config.filePath,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to adjust criteria', { error: errorMessage });
    
    return {
      success: false,
      message: `Failed to adjust criteria: ${errorMessage}`,
      criteriaPath: config.filePath,
    };
  }
}
