import { CommandHistoryEntry, EvaluationResult } from '../types/enhanced-security.js';
import { SecurityManager } from './manager.js';
import { CommandHistoryManager } from '../core/enhanced-history-manager.js';
import { getCurrentTimestamp, generateId } from '../utils/helpers.js';

/**
 * Enhanced Safety Evaluator
 * Integrates basic classification with contextual analysis for comprehensive command safety evaluation
 */
export class EnhancedSafetyEvaluator {
  private securityManager: SecurityManager;
  private historyManager: CommandHistoryManager;

  constructor(securityManager: SecurityManager, historyManager: CommandHistoryManager) {
    this.securityManager = securityManager;
    this.historyManager = historyManager;
  }

  /**
   * Comprehensive command safety evaluation
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

    // Combine evaluations
    const finalEvaluation = this.combineEvaluations(
      basicClassification,
      contextualEvaluation,
      command,
      workingDirectory
    );

    return finalEvaluation;
  }

  /**
   * Contextual evaluation based on command history and patterns
   */
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
   * Combine basic and contextual evaluations
   */
  private combineEvaluations(
    basicClassification: string,
    contextualEvaluation: ContextualEvaluation,
    command: string,
    workingDirectory: string
  ): SafetyEvaluation {
    // Convert basic classification to numeric safety level
    const basic_safety_level = basicClassification === 'basic_safe' ? 2 : 3;
    
    // Combine with contextual risk
    const combined_safety_level = Math.max(
      basic_safety_level,
      contextualEvaluation.risk_score
    );

    // Determine evaluation result
    let evaluation_result: EvaluationResult;
    let requires_confirmation = false;

    if (combined_safety_level <= 2) {
      evaluation_result = 'ALLOW';
    } else if (combined_safety_level <= 3) {
      evaluation_result = 'CONDITIONAL_DENY';
      requires_confirmation = true;
    } else {
      evaluation_result = 'DENY';
    }

    // Generate reasoning
    const reasoning = this.generateReasoning(
      basicClassification,
      contextualEvaluation,
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
      evaluation_result,
      requires_confirmation,
      reasoning,
      confidence: contextualEvaluation.confidence,
      suggested_alternatives: contextualEvaluation.suggested_alternatives
    };
  }

  /**
   * Generate human-readable reasoning for the evaluation
   */
  private generateReasoning(
    basicClassification: string,
    contextualEvaluation: ContextualEvaluation,
    safetyLevel: number
  ): string {
    const reasons: string[] = [];

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
