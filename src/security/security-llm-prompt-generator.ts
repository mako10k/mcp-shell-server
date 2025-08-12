/**
 * Security LLM Prompt Generator
 * Use mcp-llm-generator FunctionCall emulation pattern
 * Generate Structured Output format prompts to request type-safe output from LLM
 */

import { SafetyLevel } from '../types/enhanced-security.js';

export interface ElicitationHistoryEntry {
  command: string;
  timestamp: string;
  question: string;
  userResponse: string;
  evaluationResult?: string;
}

export interface CommandHistoryEntry {
  command: string;
  timestamp: string;
  exitCode?: number;
  workingDirectory?: string;
}

export interface SecurityPromptContext {
  command: string;
  workingDirectory: string;
  sessionId?: string;
  comment?: string;
  detectedPatterns?: string[];
  userContextFromHistory?: ElicitationHistoryEntry[];
  commandHistoryWithTimestamp?: CommandHistoryEntry[];
}

export interface UserIntentContext {
  originalCommand: string;
  initialEvaluation: unknown;
  userResponse: string;
  additionalContext?: string;
}

export interface AdditionalContextContext {
  originalCommand: string;
  initialEvaluation: unknown;
  additionalHistory: string[];
  environmentInfo?: string;
}

export class SecurityLLMPromptGenerator {
  /**
   * コマンド履歴とELICITATION履歴を時系列でマージ
   */
  private mergeHistoryByTimestamp(
    commandHistory: CommandHistoryEntry[],
    elicitationHistory: ElicitationHistoryEntry[]
  ): Array<{
    type: 'command' | 'elicitation';
    timestamp: string;
    content: string;
  }> {
    const merged: Array<{
      type: 'command' | 'elicitation';
      timestamp: string;
      content: string;
    }> = [];

    // Add command history
    commandHistory.forEach(entry => {
      merged.push({
        type: 'command',
        timestamp: entry.timestamp,
        content: `Command: ${entry.command}${entry.exitCode !== undefined ? ` (exit: ${entry.exitCode})` : ''}${entry.workingDirectory ? ` [${entry.workingDirectory}]` : ''}`
      });
    });

    // Add ELICITATION history
    elicitationHistory.forEach(entry => {
      merged.push({
        type: 'elicitation',
        timestamp: entry.timestamp,
        content: `Security Question: "${entry.question}" for command "${entry.command}"
User Response: "${entry.userResponse}"${entry.evaluationResult ? `
Final Decision: ${entry.evaluationResult}` : ''}`
      });
    });

    // 時系列でソート（新しい順）
    return merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /**
   * Common helper to extract initial evaluation results and reasoning
   */
  private extractInitialEvaluation(initialEvaluation: unknown): {
    result: string;
    reasoning: string;
  } {
    let initialEvalResult = '';
    let initialReasoning = '';
    if (typeof initialEvaluation === 'object' && initialEvaluation !== null) {
      const evalObj = initialEvaluation as { evaluation_result?: string; reasoning?: string };
      initialEvalResult = evalObj.evaluation_result ?? '';
      initialReasoning = evalObj.reasoning ?? '';
    }
    return { result: initialEvalResult, reasoning: initialReasoning };
  }

  /**
   * Generate system prompt for initial security evaluation
   * Function Call format is handled by ChatCompletionAdapter automatically
   */
  generateSecurityEvaluationPrompt(context: SecurityPromptContext): {
    systemPrompt: string;
    userMessage: string;
  } {
    const systemPrompt = `# Security Command Evaluator

You are an expert security evaluator specialized in analyzing shell commands for safety and risk assessment.

## Your Role
Analyze the provided shell command for potential security risks, safety concerns, and provide appropriate recommendations.

## Evaluation Guidelines
- Assess command safety based on: file access patterns, network operations, system modifications, privilege requirements
- Consider the execution context: working directory, session history, user intent
- Provide clear reasoning for your security assessment
- Suggest safer alternatives when appropriate

## Safety Levels
- ALLOW: Safe to execute without restrictions
- CONDITIONAL_DENY: Requires user confirmation or additional context
- DENY: Too dangerous to execute
- NEED_MORE_INFO: Requires additional context for proper evaluation`;

    const userMessage = `# Security Evaluation Request

## Command Analysis Required
**Command**: \`${context.command}\`
**Working Directory**: ${context.workingDirectory}
${context.comment ? `**AI Assistant Context**: ${context.comment}` : ''}

${this.generateHistorySection(context)}

${context.detectedPatterns ? `**Detected Patterns**: ${context.detectedPatterns.join(', ')}` : ''}

**INSTRUCTION**: Use the evaluate_command_security function to provide your security evaluation.`;

    return { systemPrompt, userMessage };
  }

  /**
   * Generate history section (chronological merge or individual display)
   */
  private generateHistorySection(context: SecurityPromptContext): string {
    const commandHistory = context.commandHistoryWithTimestamp;
    const elicitationHistory = context.userContextFromHistory;
    
    const hasCommandHistory = commandHistory && commandHistory.length > 0;
    const hasElicitationHistory = elicitationHistory && elicitationHistory.length > 0;

    // 両方の履歴がある場合は時系列マージ
    if (hasCommandHistory && hasElicitationHistory) {
      const mergedHistory = this.mergeHistoryByTimestamp(commandHistory, elicitationHistory);

      return `Recent Activity Timeline (most recent first):
${mergedHistory.slice(0, 10).map((entry, i) => 
  `${i + 1}. [${entry.timestamp}] ${entry.type.toUpperCase()}: ${entry.content}`
).join('\n')}`;
    }

    // Display individual history
    const sections: string[] = [];

    if (hasCommandHistory) {
      sections.push(`Recent Command History:
${commandHistory.slice(-5).map((entry, i) => 
  `${i + 1}. [${entry.timestamp}] ${entry.command}${entry.exitCode !== undefined ? ` (exit: ${entry.exitCode})` : ''}`
).join('\n')}`);
    }

    if (hasElicitationHistory) {
      sections.push(`Previous User Intent Confirmation History:
${elicitationHistory.map(entry => 
  `- Command: ${entry.command} (${entry.timestamp})
    Question: ${entry.question}
    User Response: ${entry.userResponse}${entry.evaluationResult ? `\n    Final Decision: ${entry.evaluationResult}` : ''}`
).join('\n')}`);
    }

    return sections.length > 0 ? sections.join('\n\n') : 'No activity history available';
  }

  /**
   * Generate re-evaluation prompt after user intent confirmation
   * Function Call format is handled by ChatCompletionAdapter automatically
   */
  generateUserIntentReevaluationPrompt(context: UserIntentContext): {
    systemPrompt: string;
    userMessage: string;
  } {
    const systemPrompt = `# Security Re-evaluator

You are a security re-evaluator. Based on user clarification of their intent, provide a final security decision.

## Your Role
Re-assess the command security based on the new user context and intent clarification provided.

## Guidelines
- Consider both the original evaluation and the new user context
- Make a final security decision based on the clarified intent
- Provide clear reasoning for the updated assessment`;

    const { result: initialEvalResult, reasoning: initialReasoning } =
      this.extractInitialEvaluation(context.initialEvaluation);
    const userMessage = `Re-evaluate the security of this command based on AI assistant's user intent clarification:

Original Command: \`${context.originalCommand}\`

Initial Evaluation Result: ${initialEvalResult}
Initial Reasoning: ${initialReasoning}

AI Assistant's User Intent Clarification: "${context.userResponse}"

${context.additionalContext ? `Additional Context: ${context.additionalContext}` : ''}

Provide final security evaluation as JSON only.`;

    return { systemPrompt, userMessage };
  }

  /**
   * Generate re-evaluation prompt after additional context collection
   * Function Call format is handled by ChatCompletionAdapter automatically
   */
  generateAdditionalContextReevaluationPrompt(context: AdditionalContextContext): {
    systemPrompt: string;
    userMessage: string;
  } {
    const systemPrompt = `# Security Re-evaluator with Additional Context

You are a security re-evaluator with additional context. Provide a comprehensive final security decision.

## Your Role
Re-assess the command security with the benefit of additional command history and environmental context.

## Guidelines
- Analyze patterns in the additional command history
- Consider how the new context affects the risk assessment
- Provide a comprehensive final evaluation with detailed reasoning`;

    const { result: initialEvalResult, reasoning: initialReasoning } =
      this.extractInitialEvaluation(context.initialEvaluation);
    const userMessage = `Re-evaluate security with additional context:

Original Command: \`${context.originalCommand}\`

Initial Evaluation: ${initialEvalResult}
Initial Reasoning: ${initialReasoning}

Additional Command History:
${context.additionalHistory.map((cmd, i) => `${i + 1}. ${cmd}`).join('\n')}

${context.environmentInfo ? `Environment Information: ${context.environmentInfo}` : ''}

Provide comprehensive final security evaluation.`;

    return { systemPrompt, userMessage };
  }

  /**
   * Generate system prompt for Function Call emulation
   * Refer to mcp-llm-generator patterns
   */
  generateFunctionCallEmulationPrompt(
    functionName: 'security_evaluate' | 'user_intent_reevaluate' | 'context_reevaluate',
    args: Record<string, unknown>
  ): {
    systemPrompt: string;
    userMessage: string;
  } {
    const systemPrompt = `You are a function execution emulator. You must respond as if you are executing the specified function and return the result in the exact JSON format.

CRITICAL: Your response must be ONLY valid JSON with no additional text, explanations, or formatting.

Available Functions:
1. security_evaluate: Evaluates shell command security
2. user_intent_reevaluate: Re-evaluates based on AI assistant's user intent clarification  
3. context_reevaluate: Re-evaluates with additional context

Execute the requested function and return results as JSON only.`;

    const userMessage = `Execute function: ${functionName}

Arguments: ${JSON.stringify(args, null, 2)}

Return function execution result as JSON only.`;

    return { systemPrompt, userMessage };
  }

  /**
   * Generate debug prompt (for development use only)
   */
  generateDebugPrompt(context: SecurityPromptContext): {
    systemPrompt: string;
    userMessage: string;
    expectedSchema: Record<string, unknown>;
  } {
    const { systemPrompt, userMessage } = this.generateSecurityEvaluationPrompt(context);

    return {
      systemPrompt: systemPrompt + '\n\nDEBUG MODE: Include parsing metadata in response.',
      userMessage: userMessage + '\n\nDEBUG: This is a test evaluation.',
      expectedSchema: {
        evaluation_result: 'string',
        confidence: 'number',
        reasoning: 'string',
        risk_factors: 'array',
        metadata: 'object',
      },
    };
  }

  /**
   * Safety Levelに基づくプロンプト調整
   */
  adjustPromptForSafetyLevel(
    basePrompt: { systemPrompt: string; userMessage: string },
    targetSafetyLevel: SafetyLevel
  ): { systemPrompt: string; userMessage: string } {
    const safetyInstructions: Record<SafetyLevel, string> = {
      1: 'Be very permissive. Only block clearly dangerous commands.',
      2: 'Be somewhat permissive. Allow most common operations.',
      3: 'Be balanced. Careful evaluation of moderate risks.',
      4: 'Be conservative. Require confirmation for risky operations.',
      5: 'Be very strict. Block any potentially dangerous commands.',
    };

    const enhancedSystemPrompt =
      basePrompt.systemPrompt +
      `\n\nSAFETY LEVEL ${targetSafetyLevel}: ${safetyInstructions[targetSafetyLevel]}`;

    return {
      systemPrompt: enhancedSystemPrompt,
      userMessage: basePrompt.userMessage,
    };
  }
}
