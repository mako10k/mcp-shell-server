import { promises as fs } from 'fs';
import * as path from 'path';
import {
  CommandHistoryEntry,
  CommandHistoryEntrySchema,
  UserConfirmationPattern,
  EnhancedSecurityConfig,
} from '../types/enhanced-security.js';
import { getCurrentTimestamp, generateId } from '../utils/helpers.js';

/**
 * Enhanced Command History Manager
 * Manages command execution history, evaluation results, and user confirmation patterns
 */
export class CommandHistoryManager {
  private historyPath: string;
  private history: CommandHistoryEntry[] = [];
  private userPatterns: UserConfirmationPattern[] = [];
  private config: EnhancedSecurityConfig;

  constructor(config: EnhancedSecurityConfig, historyPath?: string) {
    this.config = config;
    // Default history file path: $HOME/.mcp-shell-server/command-history.json
    this.historyPath = historyPath || this.getDefaultHistoryPath();
  }

  /**
   * Get default history file path
   */
  private getDefaultHistoryPath(): string {
    const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '.';
    const configDir = path.join(homeDir, '.mcp-shell-server');
    return path.join(configDir, 'command-history.json');
  }

  /**
   * Load history from file
   */
  async loadHistory(): Promise<void> {
    try {
      await fs.access(this.historyPath);
      const historyData = await fs.readFile(this.historyPath, 'utf-8');
      const rawHistory = JSON.parse(historyData);

      // Validate each entry
      this.history =
        rawHistory.entries?.map((entry: unknown) => CommandHistoryEntrySchema.parse(entry)) || [];

      this.userPatterns = rawHistory.userPatterns || [];

      // Cleanup old entries
      await this.cleanupOldEntries();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Start with empty history if file doesn't exist
        this.history = [];
        this.userPatterns = [];
      } else {
        throw new Error(`Failed to load command history: ${error}`);
      }
    }
  }

  /**
   * Save history to file
   */
  async saveHistory(): Promise<void> {
    try {
      const historyDir = path.dirname(this.historyPath);
      await fs.mkdir(historyDir, { recursive: true });

      const historyData = {
        metadata: {
          version: '2.2.0',
          lastUpdated: getCurrentTimestamp(),
          totalEntries: this.history.length,
          retentionDays: this.config.history_retention_days,
          maxEntries: this.config.max_history_entries,
        },
        entries: this.history,
        userPatterns: this.userPatterns,
      };

      const historyJson = JSON.stringify(historyData, null, 2);
      await fs.writeFile(this.historyPath, historyJson, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save command history: ${error}`);
    }
  }

  /**
   * Add new command history entry
   */
  async addHistoryEntry(
    entry: Omit<CommandHistoryEntry, 'execution_id' | 'timestamp'>
  ): Promise<string> {
    const fullEntry: CommandHistoryEntry = {
      ...entry,
      execution_id: generateId(),
      timestamp: getCurrentTimestamp(),
    };

    // Validation
    const validatedEntry = CommandHistoryEntrySchema.parse(fullEntry);

    this.history.unshift(validatedEntry); // Add newest at front

    // Remove old entries if max exceeded
    if (this.history.length > this.config.max_history_entries) {
      this.history = this.history.slice(0, this.config.max_history_entries);
    }

    // Auto-save (optional)
    if (this.config.command_history_enhanced) {
      await this.saveHistory();
    }

    return fullEntry.execution_id;
  }

  /**
   * Update history entry (add evaluation results, etc.)
   */
  async updateHistoryEntry(
    executionId: string,
    updates: Partial<Omit<CommandHistoryEntry, 'execution_id' | 'timestamp'>>
  ): Promise<boolean> {
    const entryIndex = this.history.findIndex((entry) => entry.execution_id === executionId);

    if (entryIndex === -1) {
      return false;
    }

    const currentEntry = this.history[entryIndex];
    if (!currentEntry) {
      return false;
    }

    // Update (preserve required fields)
    const updatedEntry: CommandHistoryEntry = {
      ...currentEntry,
      ...updates,
      execution_id: currentEntry.execution_id,
      command: currentEntry.command,
      timestamp: currentEntry.timestamp,
      working_directory: currentEntry.working_directory,
      was_executed: currentEntry.was_executed,
      resubmission_count: currentEntry.resubmission_count,
    };

    // Validation
    this.history[entryIndex] = CommandHistoryEntrySchema.parse(updatedEntry);

    // Auto-save
    if (this.config.command_history_enhanced) {
      await this.saveHistory();
    }

    return true;
  }

  /**
   * Search for similar commands in history
   */
  findSimilarCommands(command: string, limit = 10): CommandHistoryEntry[] {
    const normalizedCommand = command.toLowerCase().trim();

    return this.history
      .filter((entry) => {
        const entryCommand = entry.command.toLowerCase().trim();
        // Exact match, partial match, or first word match
        return (
          entryCommand === normalizedCommand ||
          entryCommand.includes(normalizedCommand) ||
          normalizedCommand.includes(entryCommand) ||
          entryCommand.split(' ')[0] === normalizedCommand.split(' ')[0]
        );
      })
      .slice(0, limit);
  }

  /**
   * Learn user confirmation patterns
   */
  learnUserConfirmationPattern(entry: CommandHistoryEntry): void {
    if (!entry.user_confirmation_context || !this.config.enable_resubmission_learning) {
      return;
    }

    const commandWords = entry.command.toLowerCase().trim().split(/\s+/);
    const baseCommand = commandWords[0];

    if (!baseCommand) {
      return; // Skip if command is empty
    }

    // Find existing pattern
    let pattern = this.userPatterns.find(
      (p) => p.command_pattern === baseCommand || new RegExp(p.command_pattern).test(entry.command)
    );

    if (pattern) {
      // Update existing pattern
      const totalCount = pattern.confidence * 10; // Arbitrary weight
      const newCount = totalCount + 1;
      const confirmations =
        totalCount * pattern.confirmation_rate +
        (entry.user_confirmation_context.user_response ? 1 : 0);

      pattern.confirmation_rate = confirmations / newCount;
      pattern.confidence = Math.min(1.0, newCount / 10);

      // Add reasoning (avoid duplicates)
      const reasoning = entry.user_confirmation_context.user_reasoning;
      if (reasoning && !pattern.typical_reasoning.includes(reasoning)) {
        pattern.typical_reasoning.push(reasoning);
        // Keep maximum 5 entries
        if (pattern.typical_reasoning.length > 5) {
          pattern.typical_reasoning = pattern.typical_reasoning.slice(-5);
        }
      }
    } else {
      // Create new pattern
      const newPattern: UserConfirmationPattern = {
        command_pattern: baseCommand,
        confirmation_rate: entry.user_confirmation_context.user_response ? 1.0 : 0.0,
        typical_reasoning: entry.user_confirmation_context.user_reasoning
          ? [entry.user_confirmation_context.user_reasoning]
          : [],
        confidence: 0.1, // Low initial confidence
      };
      this.userPatterns.push(newPattern);
    }
  }

  /**
   * Predict user confirmation for a command
   */
  predictUserConfirmation(command: string): {
    likely_to_confirm: boolean;
    confidence: number;
    reasoning: string[];
  } {
    const commandWords = command.toLowerCase().trim().split(/\s+/);
    const baseCommand = commandWords[0];

    // Find matching patterns
    const matchingPatterns = this.userPatterns.filter((pattern) => {
      try {
        return (
          pattern.command_pattern === baseCommand ||
          new RegExp(pattern.command_pattern).test(command)
        );
      } catch {
        return pattern.command_pattern === baseCommand;
      }
    });

    if (matchingPatterns.length === 0) {
      return {
        likely_to_confirm: false,
        confidence: 0.0,
        reasoning: [],
      };
    }

    // Weighted average prediction
    let totalWeight = 0;
    let weightedConfirmationRate = 0;
    const allReasoning: string[] = [];

    matchingPatterns.forEach((pattern) => {
      const weight = pattern.confidence;
      totalWeight += weight;
      weightedConfirmationRate += pattern.confirmation_rate * weight;
      allReasoning.push(...pattern.typical_reasoning);
    });

    const avgConfirmationRate = totalWeight > 0 ? weightedConfirmationRate / totalWeight : 0;
    const confidence = totalWeight / matchingPatterns.length;

    return {
      likely_to_confirm: avgConfirmationRate > 0.5,
      confidence,
      reasoning: [...new Set(allReasoning)], // Remove duplicates
    };
  }

  /**
   * Cleanup old history entries
   */
  private async cleanupOldEntries(): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.history_retention_days);

    const initialCount = this.history.length;
    this.history = this.history.filter((entry) => {
      const entryDate = new Date(entry.timestamp);
      return entryDate >= cutoffDate;
    });

    const removedCount = initialCount - this.history.length;
    if (removedCount > 0) {
      console.error(`Cleaned up ${removedCount} old command history entries`);
    }
  }

  /**
   * Get history statistics
   */
  getHistoryStats(): {
    totalEntries: number;
    entriesWithEvaluation: number;
    entriesWithConfirmation: number;
    topCommands: Array<{ command: string; count: number }>;
    confirmationPatterns: UserConfirmationPattern[];
  } {
    const commandCounts = new Map<string, number>();
    let entriesWithEvaluation = 0;
    let entriesWithConfirmation = 0;

    this.history.forEach((entry) => {
      // Count commands
      const baseCommand = entry.command.split(' ')[0];
      if (baseCommand) {
        commandCounts.set(baseCommand, (commandCounts.get(baseCommand) || 0) + 1);
      }

      // Check evaluation results
      if (entry.llm_evaluation_result || entry.safety_classification) {
        entriesWithEvaluation++;
      }

      // Check confirmations
      if (entry.user_confirmation_context) {
        entriesWithConfirmation++;
      }
    });

    // Get top commands
    const topCommands = Array.from(commandCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([command, count]) => ({ command, count }));

    return {
      totalEntries: this.history.length,
      entriesWithEvaluation,
      entriesWithConfirmation,
      topCommands,
      confirmationPatterns: [...this.userPatterns],
    };
  }

  /**
   * Search history
   */
  searchHistory(query: {
    command?: string;
    working_directory?: string;
    was_executed?: boolean;
    safety_classification?: string;
    limit?: number;
  }): CommandHistoryEntry[] {
    let filtered = this.history;

    if (query.command) {
      const searchTerm = query.command.toLowerCase();
      filtered = filtered.filter((entry) => entry.command.toLowerCase().includes(searchTerm));
    }

    if (query.working_directory) {
      filtered = filtered.filter((entry) => entry.working_directory === query.working_directory);
    }

    if (query.was_executed !== undefined) {
      filtered = filtered.filter((entry) => entry.was_executed === query.was_executed);
    }

    if (query.safety_classification) {
      filtered = filtered.filter(
        (entry) => entry.safety_classification === query.safety_classification
      );
    }

    return filtered.slice(0, query.limit || 50);
  }

  /**
   * Clear all history
   */
  async clearHistory(): Promise<void> {
    this.history = [];
    this.userPatterns = [];
    await this.saveHistory();
  }

  /**
   * Get history file path
   */
  getHistoryPath(): string {
    return this.historyPath;
  }
}
