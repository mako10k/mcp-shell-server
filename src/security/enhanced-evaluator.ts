import { CommandHistoryEntry, EvaluationResult } from '../types/enhanced-security.js';
import { SecurityManager } from './manager.js';
import { CommandHistoryManager } from '../core/enhanced-history-manager.js';
import { getCurrentTimestamp, generateId } from '../utils/helpers.js';

// MCP sampling protocol interface (based on mako10k/mcp-llm-generator)
interface CreateMessageCallback {
  (params: {
    messages: Array<{
      role: 'user' | 'assistant';
      content: {
        type: 'text';
        text: string;
      };
    }>;
    maxTokens?: number;
    temperature?: number;
    systemPrompt?: string;
    includeContext?: 'none' | 'thisServer' | 'allServers';
    stopSequences?: string[];
    metadata?: Record<string, unknown>;
    modelPreferences?: {
      hints?: Array<{ name?: string }>;
      costPriority?: number;
      speedPriority?: number;
      intelligencePriority?: number;
    };
  }): Promise<{
    content: {
      type: 'text';
      text: string;
    };
    model?: string | undefined;
    stopReason?: string | undefined;
  }>;
}

// LLM evaluation result from MCP sampling
interface LLMEvaluationResult {
  evaluation_result: EvaluationResult;
  confidence: number;
  llm_reasoning: string;
  model: string;
  evaluation_time_ms: number;
}

/**
 * Enhanced Safety Evaluator
 * Integrates basic classification with contextual analysis for comprehensive command safety evaluation
 * Implements LLM Sampler evaluation based on mako10k/mcp-llm-generator
 */
export class EnhancedSafetyEvaluator {
  private securityManager: SecurityManager;
  private historyManager: CommandHistoryManager;
  private createMessageCallback?: CreateMessageCallback;

  constructor(securityManager: SecurityManager, historyManager: CommandHistoryManager) {
    this.securityManager = securityManager;
    this.historyManager = historyManager;
  }

  /**
   * Set the LLM sampling callback (MCP createMessage)
   */
  setCreateMessageCallback(callback: CreateMessageCallback): void {
    this.createMessageCallback = callback;
  }

  /**
   * Comprehensive command safety evaluation with LLM Sampler integration
   */
  async evaluateCommand(
    command: string,
    workingDirectory: string,
    contextSize: number = 10
  ): Promise<SafetyEvaluation> {
    // Basic safety classification
    const basicClassification = this.securityManager.classifyCommandSafety(command);
    
    // Get command history for context
    const historyEntries = await this.historyManager.searchHistory({
      limit: contextSize
    });

    // Perform contextual evaluation
    const contextualEvaluation = await this.performContextualEvaluation(
      command,
      workingDirectory,
      historyEntries
    );

    // LLM Sampler evaluation (if callback available)
    let llmEvaluation: LLMEvaluationResult | null = null;
    if (this.createMessageCallback && basicClassification === 'llm_required') {
      llmEvaluation = await this.performLLMEvaluation(
        command,
        workingDirectory,
        historyEntries
      );
    }

    // Combine evaluations
    const finalEvaluation = this.combineEvaluations(
      basicClassification,
      contextualEvaluation,
      llmEvaluation,
      command,
      workingDirectory
    );

    return finalEvaluation;
  }

  /**
   * LLM Sampler evaluation using MCP createMessage protocol
   */
  private async performLLMEvaluation(
    command: string,
    workingDirectory: string,
    history: CommandHistoryEntry[]
  ): Promise<LLMEvaluationResult> {
    if (!this.createMessageCallback) {
      throw new Error('LLM evaluation callback not available');
    }

    try {
      // Prepare context for LLM evaluation
      const historyContext = history
        .slice(0, 5)
        .map(entry => `${entry.command} (${entry.working_directory})`)
        .join('\n');

      const sensitiveDirectories = ['/etc', '/var', '/usr', '/sys', '/proc', '/root'];
      const isSensitiveDir = sensitiveDirectories.some(dir => 
        workingDirectory.startsWith(dir)
      );

      // Create evaluation prompt
      const evaluationPrompt = `Evaluate the safety of this shell command:

Command: ${command}
Working Directory: ${workingDirectory}
Is Sensitive Directory: ${isSensitiveDir}

Recent Command History:
${historyContext || 'No recent history'}

SECURITY GUIDELINES:
- Commands modifying user environment (.bashrc, .profile, etc.) should be CONDITIONAL_DENY
- File operations outside working directory require extra caution
- Network downloads with execution (curl|bash, wget|sh) should be DENY
- System file modifications (/etc, /var, /usr) should be CONDITIONAL_DENY or DENY
- Privilege escalation (sudo, su) should be CONDITIONAL_DENY
- Destructive operations (rm -rf, dd, mkfs) should be DENY

Please evaluate this command and respond with EXACTLY one of these classifications:
- ALLOW: Safe to execute without confirmation
- CONDITIONAL_DENY: Requires user confirmation due to potential risks
- DENY: Too dangerous to execute

Consider:
1. User environment modification (config files, environment variables)
2. Potential for system damage or data loss
3. Security risks and privilege escalation
4. Working directory and file access patterns
5. Network access and remote code execution risks`;

      // Call LLM via MCP sampling protocol
      const response = await this.createMessageCallback({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: evaluationPrompt
            }
          }
        ],
        maxTokens: 150,
        temperature: 0.1, // Low temperature for consistent evaluation
        systemPrompt: 'You are a strict security evaluator focused on protecting user environments and preventing unauthorized system modifications. Prioritize user consent for any environment changes. Be conservative in your evaluations.',
        includeContext: 'none'
      });

      // Parse LLM response
      const llmResponse = response.content.text.trim().toUpperCase();
      let evaluation_result: EvaluationResult;
      let confidence = 0.8; // Default confidence

      if (llmResponse.includes('ALLOW')) {
        evaluation_result = 'ALLOW';
        confidence = 0.9;
      } else if (llmResponse.includes('CONDITIONAL_DENY')) {
        evaluation_result = 'CONDITIONAL_DENY';
        confidence = 0.8;
      } else if (llmResponse.includes('DENY')) {
        evaluation_result = 'DENY';
        confidence = 0.9;
      } else {
        // Fallback for unclear responses
        evaluation_result = 'CONDITIONAL_DENY';
        confidence = 0.5;
      }

      return {
        evaluation_result,
        confidence,
        llm_reasoning: response.content.text,
        model: response.model || 'unknown',
        evaluation_time_ms: Date.now() // Simplified timing
      };

    } catch (error) {
      console.error('LLM evaluation failed:', error);
      // Fallback to safe default
      return {
        evaluation_result: 'CONDITIONAL_DENY',
        confidence: 0.3,
        llm_reasoning: `LLM evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        model: 'error',
        evaluation_time_ms: Date.now()
      };
    }
  }
  private async performContextualEvaluation(
    command: string,
    workingDirectory: string,
    history: CommandHistoryEntry[]
  ): Promise<ContextualEvaluation> {
    const analysis = {
      repeated_pattern: this.analyzeRepetitionPattern(command, history),
      escalation_risk: this.analyzeEscalationRisk(command, history),
      working_directory_risk: this.analyzeWorkingDirectoryRisk(workingDirectory, history),
      time_pattern_risk: this.analyzeTimePatternRisk(command, history),
      similar_commands: this.findSimilarCommands(command, history)
    };

    const risk_score = this.calculateContextualRiskScore(analysis);
    const confidence = this.calculateConfidence(analysis, history.length);

    return {
      risk_score,
      confidence,
      analysis,
      requires_confirmation: risk_score >= 3,
      suggested_alternatives: this.generateAlternatives(command, analysis)
    };
  }

  /**
   * Analyze if command is part of a repeated dangerous pattern
   */
  private analyzeRepetitionPattern(command: string, history: CommandHistoryEntry[]): RepetitionAnalysis {
    const recentSimilar = history
      .filter(entry => {
        const normalizedCommand = command.toLowerCase().trim();
        const entryCommand = entry.command.toLowerCase().trim();
        const commandFirstWord = normalizedCommand.split(' ')[0] || '';
        const entryFirstWord = entryCommand.split(' ')[0] || '';
        
        return entryCommand.includes(commandFirstWord) ||
               normalizedCommand.includes(entryFirstWord) ||
               entryFirstWord === commandFirstWord;
      })
      .slice(0, 5);

    const frequency = recentSimilar.length;
    const time_span_minutes = this.calculateTimeSpan(recentSimilar);
    const escalating = this.isEscalatingPattern(command, recentSimilar);

    return {
      frequency,
      time_span_minutes,
      escalating,
      risk_level: this.calculateRepetitionRisk(frequency, time_span_minutes, escalating)
    };
  }

  /**
   * Analyze if current command represents privilege escalation
   */
  private analyzeEscalationRisk(command: string, history: CommandHistoryEntry[]): EscalationAnalysis {
    const escalation_keywords = ['sudo', 'su', 'chmod', 'chown', 'passwd', 'usermod'];
    const has_escalation = escalation_keywords.some(keyword => 
      command.toLowerCase().includes(keyword)
    );

    const recent_escalations = history
      .filter(entry => 
        escalation_keywords.some(keyword => 
          entry.command.toLowerCase().includes(keyword)
        )
      )
      .slice(0, 3);

    return {
      has_escalation,
      recent_escalation_count: recent_escalations.length,
      risk_level: has_escalation ? 
        (recent_escalations.length > 0 ? 4 : 3) : 1
    };
  }

  /**
   * Analyze working directory related risks
   */
  private analyzeWorkingDirectoryRisk(workingDirectory: string, history: CommandHistoryEntry[]): DirectoryRiskAnalysis {
    const sensitive_directories = ['/etc', '/var', '/usr', '/sys', '/proc', '/root'];
    const is_sensitive = sensitive_directories.some(dir => 
      workingDirectory.startsWith(dir)
    );

    const directory_changes = history
      .filter(entry => entry.working_directory !== workingDirectory)
      .length;

    return {
      is_sensitive_directory: is_sensitive,
      recent_directory_changes: directory_changes,
      risk_level: is_sensitive ? 3 : 1
    };
  }

  /**
   * Analyze time-based patterns that might indicate automation or suspicious activity
   */
  private analyzeTimePatternRisk(_command: string, history: CommandHistoryEntry[]): TimePatternAnalysis {
    if (history.length < 3) {
      return {
        rapid_execution: false,
        automated_pattern: false,
        risk_level: 1
      };
    }

    const recent_entries = history.slice(0, 5);
    const time_intervals = this.calculateTimeIntervals(recent_entries);
    
    const rapid_execution = time_intervals.some(interval => interval < 1000); // < 1 second
    const automated_pattern = this.isAutomatedPattern(time_intervals);

    return {
      rapid_execution,
      automated_pattern,
      risk_level: (rapid_execution || automated_pattern) ? 3 : 1
    };
  }

  /**
   * Find similar commands in history
   */
  private findSimilarCommands(command: string, _history: CommandHistoryEntry[]): CommandHistoryEntry[] {
    return this.historyManager.findSimilarCommands(command, 5);
  }

  /**
   * Calculate overall contextual risk score
   */
  private calculateContextualRiskScore(analysis: ContextualAnalysis): number {
    const weights = {
      repetition: 0.3,
      escalation: 0.4,
      directory: 0.2,
      time_pattern: 0.1
    };

    const weighted_score = 
      analysis.repeated_pattern.risk_level * weights.repetition +
      analysis.escalation_risk.risk_level * weights.escalation +
      analysis.working_directory_risk.risk_level * weights.directory +
      analysis.time_pattern_risk.risk_level * weights.time_pattern;

    return Math.min(5, Math.max(1, Math.round(weighted_score)));
  }

  /**
   * Calculate confidence in the evaluation
   */
  private calculateConfidence(analysis: ContextualAnalysis, historySize: number): number {
    const base_confidence = Math.min(0.8, historySize / 20); // More history = higher confidence
    const pattern_confidence = analysis.repeated_pattern.frequency > 0 ? 0.2 : 0;
    
    return Math.min(1.0, base_confidence + pattern_confidence);
  }

  /**
   * Combine basic, contextual, and LLM evaluations
   */
  private combineEvaluations(
    basicClassification: string,
    contextualEvaluation: ContextualEvaluation,
    llmEvaluation: LLMEvaluationResult | null,
    command: string,
    workingDirectory: string
  ): SafetyEvaluation {
    // Convert basic classification to numeric safety level
    const basic_safety_level = basicClassification === 'basic_safe' ? 2 : 3;
    
    // Combine with contextual risk
    let combined_safety_level = Math.max(
      basic_safety_level,
      contextualEvaluation.risk_score
    );

    // LLM evaluation takes highest priority when available
    let final_evaluation_result: EvaluationResult;
    let final_confidence = contextualEvaluation.confidence;

    if (llmEvaluation) {
      // LLM evaluation overrides other evaluations
      final_evaluation_result = llmEvaluation.evaluation_result;
      final_confidence = Math.max(final_confidence, llmEvaluation.confidence);
      
      // Adjust safety level based on LLM result
      switch (llmEvaluation.evaluation_result) {
        case 'ALLOW':
          combined_safety_level = Math.min(combined_safety_level, 2);
          break;
        case 'CONDITIONAL_DENY':
          combined_safety_level = Math.max(combined_safety_level, 3);
          break;
        case 'DENY':
          combined_safety_level = Math.max(combined_safety_level, 4);
          break;
      }
    } else {
      // Use combined safety level without LLM
      if (combined_safety_level <= 2) {
        final_evaluation_result = 'ALLOW';
      } else if (combined_safety_level <= 3) {
        final_evaluation_result = 'CONDITIONAL_DENY';
      } else {
        final_evaluation_result = 'DENY';
      }
    }

    const requires_confirmation = final_evaluation_result === 'CONDITIONAL_DENY';

    // Generate reasoning
    const reasoning = this.generateReasoning(
      basicClassification,
      contextualEvaluation,
      llmEvaluation,
      combined_safety_level
    );

    return {
      evaluation_id: generateId(),
      timestamp: getCurrentTimestamp(),
      command,
      working_directory: workingDirectory,
      safety_level: combined_safety_level,
      basic_classification: basicClassification,
      contextual_evaluation: contextualEvaluation,
      llm_evaluation: llmEvaluation,
      evaluation_result: final_evaluation_result,
      requires_confirmation,
      reasoning,
      confidence: final_confidence,
      suggested_alternatives: contextualEvaluation.suggested_alternatives
    };
  }

  /**
   * Generate human-readable reasoning for the evaluation
   */
  private generateReasoning(
    basicClassification: string,
    contextualEvaluation: ContextualEvaluation,
    llmEvaluation: LLMEvaluationResult | null,
    safetyLevel: number
  ): string {
    const reasons: string[] = [];

    // LLM evaluation reasoning (highest priority)
    if (llmEvaluation) {
      reasons.push(`LLM Analysis (${llmEvaluation.model}): ${llmEvaluation.llm_reasoning}`);
      reasons.push(`LLM Confidence: ${(llmEvaluation.confidence * 100).toFixed(1)}%`);
    }

    // Basic classification reasoning
    if (basicClassification === 'llm_required') {
      reasons.push('Command requires detailed safety analysis');
    }

    // Contextual reasons
    if (contextualEvaluation.analysis.repeated_pattern.frequency > 2) {
      reasons.push(`Command repeated ${contextualEvaluation.analysis.repeated_pattern.frequency} times recently`);
    }

    if (contextualEvaluation.analysis.escalation_risk.has_escalation) {
      reasons.push('Command involves privilege escalation');
    }

    if (contextualEvaluation.analysis.working_directory_risk.is_sensitive_directory) {
      reasons.push('Executing in sensitive system directory');
    }

    if (contextualEvaluation.analysis.time_pattern_risk.automated_pattern) {
      reasons.push('Detected potentially automated execution pattern');
    }

    // Final assessment
    if (safetyLevel <= 2) {
      reasons.push('Overall risk assessment: Low');
    } else if (safetyLevel <= 3) {
      reasons.push('Overall risk assessment: Moderate - requires confirmation');
    } else {
      reasons.push('Overall risk assessment: High - execution not recommended');
    }

    return reasons.length > 0 ? reasons.join('. ') : 'Standard safety evaluation completed';
  }

  /**
   * Generate suggested alternatives for potentially risky commands
   */
  private generateAlternatives(command: string, analysis: ContextualAnalysis): string[] {
    const alternatives: string[] = [];

    // Add confirmation commands for context
    if (analysis.working_directory_risk.is_sensitive_directory) {
      alternatives.push('pwd # Check current directory');
      alternatives.push('ls -la # List directory contents');
    }

    // Add safer alternatives for common dangerous patterns
    if (command.includes('rm ') && !command.includes(' -i')) {
      alternatives.push(command.replace('rm ', 'rm -i ') + ' # Add interactive mode');
    }

    if (command.includes('chmod ') || command.includes('chown ')) {
      alternatives.push('ls -la # Check current permissions first');
    }

    return alternatives;
  }

  // Helper methods for calculations
  private calculateTimeSpan(entries: CommandHistoryEntry[]): number {
    if (entries.length < 2) return 0;
    
    const firstEntry = entries[entries.length - 1];
    const lastEntry = entries[0];
    
    if (!firstEntry || !lastEntry) return 0;
    
    const first = new Date(firstEntry.timestamp);
    const last = new Date(lastEntry.timestamp);
    
    return (last.getTime() - first.getTime()) / (1000 * 60); // minutes
  }

  private isEscalatingPattern(command: string, history: CommandHistoryEntry[]): boolean {
    // Simple heuristic: commands getting more complex or dangerous
    const current_risk = this.getCommandRiskScore(command);
    const avg_history_risk = history.length > 0 
      ? history.reduce((sum, entry) => sum + this.getCommandRiskScore(entry.command), 0) / history.length
      : 1;
    
    return current_risk > avg_history_risk + 1;
  }

  private getCommandRiskScore(command: string): number {
    const dangerous_keywords = ['rm', 'delete', 'format', 'dd', 'sudo', 'su'];
    const moderate_keywords = ['chmod', 'chown', 'mv', 'cp'];
    
    if (dangerous_keywords.some(keyword => command.toLowerCase().includes(keyword))) {
      return 4;
    }
    if (moderate_keywords.some(keyword => command.toLowerCase().includes(keyword))) {
      return 3;
    }
    return 2;
  }

  private calculateRepetitionRisk(frequency: number, timeSpan: number, escalating: boolean): number {
    if (frequency <= 1) return 1;
    
    let risk = 2;
    if (frequency > 3) risk += 1;
    if (timeSpan < 5) risk += 1; // Very rapid repetition
    if (escalating) risk += 1;
    
    return Math.min(5, risk);
  }

  private calculateTimeIntervals(entries: CommandHistoryEntry[]): number[] {
    const intervals: number[] = [];
    
    for (let i = 0; i < entries.length - 1; i++) {
      const currentEntry = entries[i];
      const nextEntry = entries[i + 1];
      
      if (!currentEntry || !nextEntry) continue;
      
      const current = new Date(currentEntry.timestamp);
      const next = new Date(nextEntry.timestamp);
      intervals.push(current.getTime() - next.getTime());
    }
    
    return intervals;
  }

  private isAutomatedPattern(intervals: number[]): boolean {
    if (intervals.length < 3) return false;
    
    // Check for regular intervals (within 10% variance)
    const avg_interval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const variance = intervals.every(interval => 
      Math.abs(interval - avg_interval) / avg_interval < 0.1
    );
    
    return variance && avg_interval < 5000; // Less than 5 seconds average
  }
}

// Type definitions for evaluation results
interface SafetyEvaluation {
  evaluation_id: string;
  timestamp: string;
  command: string;
  working_directory: string;
  safety_level: number;
  basic_classification: string;
  contextual_evaluation: ContextualEvaluation;
  llm_evaluation: LLMEvaluationResult | null;
  evaluation_result: EvaluationResult;
  requires_confirmation: boolean;
  reasoning: string;
  confidence: number;
  suggested_alternatives: string[];
}

interface ContextualEvaluation {
  risk_score: number;
  confidence: number;
  analysis: ContextualAnalysis;
  requires_confirmation: boolean;
  suggested_alternatives: string[];
}

interface ContextualAnalysis {
  repeated_pattern: RepetitionAnalysis;
  escalation_risk: EscalationAnalysis;
  working_directory_risk: DirectoryRiskAnalysis;
  time_pattern_risk: TimePatternAnalysis;
  similar_commands: CommandHistoryEntry[];
}

interface RepetitionAnalysis {
  frequency: number;
  time_span_minutes: number;
  escalating: boolean;
  risk_level: number;
}

interface EscalationAnalysis {
  has_escalation: boolean;
  recent_escalation_count: number;
  risk_level: number;
}

interface DirectoryRiskAnalysis {
  is_sensitive_directory: boolean;
  recent_directory_changes: number;
  risk_level: number;
}

interface TimePatternAnalysis {
  rapid_execution: boolean;
  automated_pattern: boolean;
  risk_level: number;
}
