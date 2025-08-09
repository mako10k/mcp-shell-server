/**
 * Security LLM Prompt Generator
 * mcp-llm-generator のFunctionCall emulation patternを使用
 * Structured Output形式のプロンプトを生成してLLMに型安全な出力を要求
 */

import { SafetyLevel } from '../types/enhanced-security.js';

export interface SecurityPromptContext {
  command: string;
  commandHistory: string[];
  workingDirectory: string;
  sessionId?: string;
  comment?: string;
  detectedPatterns?: string[];
  userContextFromHistory?: string;
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
   * 初回セキュリティ評価用のStructured OutputプロンプトTO生成
   */
  generateSecurityEvaluationPrompt(context: SecurityPromptContext): {
    systemPrompt: string;
    userMessage: string;
  } {
    const systemPrompt = `You are an expert security evaluator for shell commands. You must respond ONLY with valid JSON matching this exact schema - NO additional text, explanations, or markdown formatting.

REQUIRED JSON SCHEMA:
{
  "evaluation_result": "ALLOW" | "CONDITIONAL_ALLOW" | "CONDITIONAL_DENY" | "DENY" | "ELICIT_USER_INTENT" | "NEED_MORE_INFO",
  "confidence": number (0.0 to 1.0),
  "reasoning": "string explaining the decision",
  "risk_factors": [
    {
      "category": "destructive_action" | "data_access" | "network_access" | "system_modification" | "unclear_intent" | "suspicious_pattern",
      "description": "string",
      "severity": "low" | "medium" | "high" | "critical"
    }
  ],
  "metadata": {
    "requires_additional_context": boolean,
    "requires_user_intent": boolean,
    "suggested_alternatives": ["string"],
    "safety_level": 1 | 2 | 3 | 4 | 5
  }
}

EVALUATION GUIDELINES:
- ALLOW: Safe commands with no significant risks
- CONDITIONAL_ALLOW: Generally safe but may need monitoring
- CONDITIONAL_DENY: Risky commands that need user confirmation
- DENY: Dangerous commands that should be blocked
- ELICIT_USER_INTENT: Command intent is unclear, need user clarification
- NEED_MORE_INFO: Need additional context/history to make decision

Safety levels: 1=completely safe, 2=mostly safe, 3=moderate risk, 4=high risk, 5=critical risk

Respond with ONLY the JSON object, no other text.`;

    const userMessage = `Evaluate this shell command for security:

Command: \`${context.command}\`
Working Directory: ${context.workingDirectory}
${context.comment ? `User Comment: ${context.comment}` : ''}

${context.commandHistory.length > 0 ? `Recent Command History:
${context.commandHistory.slice(-5).map((cmd, i) => `${i + 1}. ${cmd}`).join('\n')}` : 'No recent command history'}

${context.detectedPatterns ? `Detected Patterns: ${context.detectedPatterns.join(', ')}` : ''}

${context.userContextFromHistory ? `User Context: ${context.userContextFromHistory}` : ''}

Return the security evaluation as JSON only.`;

    return { systemPrompt, userMessage };
  }

  /**
   * ユーザ意図確認後の再評価プロンプト生成
   */
  generateUserIntentReevaluationPrompt(context: UserIntentContext): {
    systemPrompt: string;
    userMessage: string;
  } {
    const systemPrompt = `You are a security re-evaluator. Based on user clarification of their intent, provide a final security decision. Respond ONLY with valid JSON - NO additional text.

REQUIRED JSON SCHEMA:
{
  "final_evaluation": "ALLOW" | "CONDITIONAL_ALLOW" | "CONDITIONAL_DENY" | "DENY",
  "confidence": number (0.0 to 1.0),
  "reasoning": "string explaining the final decision",
  "intent_analysis": {
    "understood_intent": "string",
    "intent_matches_command": boolean,
    "risk_level_changed": boolean
  },
  "updated_risk_factors": [
    {
      "category": "destructive_action" | "data_access" | "network_access" | "system_modification" | "unclear_intent" | "suspicious_pattern",
      "description": "string",
      "severity": "low" | "medium" | "high" | "critical"
    }
  ],
  "metadata": {
    "safety_level": 1 | 2 | 3 | 4 | 5,
    "monitoring_required": boolean,
    "suggested_safeguards": ["string"]
  }
}

Respond with ONLY the JSON object.`;

    let initialEvalResult = '';
    let initialReasoning = '';
    if (typeof context.initialEvaluation === 'object' && context.initialEvaluation !== null) {
      const evalObj = context.initialEvaluation as { evaluation_result?: string; reasoning?: string };
      initialEvalResult = evalObj.evaluation_result ?? '';
      initialReasoning = evalObj.reasoning ?? '';
    }
    const userMessage = `Re-evaluate the security of this command based on user intent clarification:

Original Command: \`${context.originalCommand}\`

Initial Evaluation Result: ${initialEvalResult}
Initial Reasoning: ${initialReasoning}

User's Intent Clarification: "${context.userResponse}"

${context.additionalContext ? `Additional Context: ${context.additionalContext}` : ''}

Provide final security evaluation as JSON only.`;

    return { systemPrompt, userMessage };
  }

  /**
   * 追加コンテキスト収集後の再評価プロンプト生成
   */
  generateAdditionalContextReevaluationPrompt(context: AdditionalContextContext): {
    systemPrompt: string;
    userMessage: string;
  } {
    const systemPrompt = `You are a security re-evaluator with additional context. Provide a comprehensive final security decision. Respond ONLY with valid JSON - NO additional text.

REQUIRED JSON SCHEMA:
{
  "final_evaluation": "ALLOW" | "CONDITIONAL_ALLOW" | "CONDITIONAL_DENY" | "DENY",
  "confidence": number (0.0 to 1.0),
  "reasoning": "string explaining the final decision with context analysis",
  "context_analysis": {
    "additional_context_helpful": boolean,
    "context_changes_risk": boolean,
    "pattern_identified": string | null
  },
  "comprehensive_risk_factors": [
    {
      "category": "destructive_action" | "data_access" | "network_access" | "system_modification" | "unclear_intent" | "suspicious_pattern",
      "description": "string",
      "severity": "low" | "medium" | "high" | "critical",
      "context_informed": boolean
    }
  ],
  "metadata": {
    "safety_level": 1 | 2 | 3 | 4 | 5,
    "monitoring_required": boolean,
    "context_quality": "low" | "medium" | "high",
    "final_recommendations": ["string"]
  }
}

Respond with ONLY the JSON object.`;

    let initialEvalResult = '';
    let initialReasoning = '';
    if (typeof context.initialEvaluation === 'object' && context.initialEvaluation !== null) {
      const evalObj = context.initialEvaluation as { evaluation_result?: string; reasoning?: string };
      initialEvalResult = evalObj.evaluation_result ?? '';
      initialReasoning = evalObj.reasoning ?? '';
    }
    const userMessage = `Re-evaluate security with additional context:

Original Command: \`${context.originalCommand}\`

Initial Evaluation: ${initialEvalResult}
Initial Reasoning: ${initialReasoning}

Additional Command History:
${context.additionalHistory.map((cmd, i) => `${i + 1}. ${cmd}`).join('\n')}

${context.environmentInfo ? `Environment Information: ${context.environmentInfo}` : ''}

Provide comprehensive final security evaluation as JSON only.`;

    return { systemPrompt, userMessage };
  }

  /**
   * Function Call emulation用のシステムプロンプト生成
   * mcp-llm-generator のパターンを参考
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
2. user_intent_reevaluate: Re-evaluates based on user intent clarification  
3. context_reevaluate: Re-evaluates with additional context

Execute the requested function and return results as JSON only.`;

    const userMessage = `Execute function: ${functionName}

Arguments: ${JSON.stringify(args, null, 2)}

Return function execution result as JSON only.`;

    return { systemPrompt, userMessage };
  }

  /**
   * デバッグ用のプロンプト生成（開発時のみ使用）
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
        metadata: 'object'
      }
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
      5: 'Be very strict. Block any potentially dangerous commands.'
    };

    const enhancedSystemPrompt = basePrompt.systemPrompt + 
      `\n\nSAFETY LEVEL ${targetSafetyLevel}: ${safetyInstructions[targetSafetyLevel]}`;

    return {
      systemPrompt: enhancedSystemPrompt,
      userMessage: basePrompt.userMessage
    };
  }
}
