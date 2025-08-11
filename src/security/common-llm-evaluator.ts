/**
 * Common LLM Evaluation Base Class
 * Structured Output対応の共通評価ロジックを提供
 * enhanced-evaluator.tsの重複コードを共通化
 */

import { EvaluationResult } from '../types/enhanced-security.js';
import { SecurityResponseParser } from './security-response-parser.js';
import { SecurityLLMPromptGenerator } from './security-llm-prompt-generator.js';
import { BaseParseError } from './base-response-parser.js';

// MCP sampling protocol interface
interface CreateMessageCallback {
  (request: {
    messages: Array<{
      role: 'user' | 'assistant';
      content: { type: 'text'; text: string };
    }>;
    maxTokens?: number;
    temperature?: number;
    systemPrompt?: string;
    includeContext?: 'none' | 'thisServer' | 'allServers';
    stopSequences?: string[];
    metadata?: Record<string, unknown>;
    modelPreferences?: Record<string, unknown>;
  }): Promise<{
    content: { type: 'text'; text: string };
    model?: string | undefined;
    stopReason?: string | undefined;
  }>;
}

export type { CreateMessageCallback };

// 共通の評価結果インターフェース
export interface CommonLLMEvaluationResult {
  evaluation_result: EvaluationResult;
  // Removed confidence property
  llm_reasoning: string;
  model: string;
  evaluation_time_ms: number;
}

// 共通の評価コンテキスト
export interface CommonEvaluationContext {
  command: string;
  workingDirectory: string;
  comment?: string;
  additionalContext?: Record<string, unknown>;
}

export class CommonLLMEvaluator {
  protected responseParser: SecurityResponseParser;
  protected promptGenerator: SecurityLLMPromptGenerator;
  protected createMessageCallback: CreateMessageCallback;

  constructor(
    createMessageCallback: CreateMessageCallback,
    responseParser: SecurityResponseParser,
    promptGenerator: SecurityLLMPromptGenerator
  ) {
    this.createMessageCallback = createMessageCallback;
    this.responseParser = responseParser;
    this.promptGenerator = promptGenerator;
  }

  /**
   * 共通のLLM呼び出しロジック（Structured Output対応）
   */
  protected async callLLMWithStructuredOutput<T>(
    systemPrompt: string,
    userMessage: string,
    parserMethod: (
      content: string,
      requestId: string
    ) => Promise<{ success: boolean; data?: T; errors?: BaseParseError[]; metadata: { parseTime: number } }>,
    maxTokens: number = 200,
    temperature: number = 0.1
  ): Promise<CommonLLMEvaluationResult> {
    try {
      // Check if callback is properly initialized
      if (!this.createMessageCallback || typeof this.createMessageCallback !== 'function') {
        throw new Error(
          'LLM evaluation attempted before createMessageCallback was properly initialized'
        );
      }

      const response = await this.createMessageCallback({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: userMessage,
            },
          },
        ],
        maxTokens,
        temperature,
        systemPrompt,
        includeContext: 'none',
      });

      // Structured Output解析を試行
      const requestId = `eval_${Date.now()}`;
      const parseResult = await parserMethod.call(
        this.responseParser,
        response.content.text,
        requestId
      );

      if (parseResult.success && parseResult.data) {
        return this.extractEvaluationFromStructuredResult(
          parseResult.data,
          response.model,
          parseResult.metadata.parseTime
        );
      } else {
        // フォールバック: 従来のパース方法
        console.warn('Structured Output parsing failed, using fallback:', parseResult.errors);
        return this.createFallbackEvaluation(response.content.text, response.model);
      }
    } catch (error) {
      console.error('LLM evaluation failed:', error);
      throw error;
    }
  }

  /**
   * Structured Outputから評価結果を抽出
   */
  private extractEvaluationFromStructuredResult(
    data: unknown,
    model?: string,
    parseTime?: number
  ): CommonLLMEvaluationResult {
    let evaluation_result: EvaluationResult = 'CONDITIONAL_DENY';
    let llm_reasoning = 'No reasoning provided';
    let eval_time = Date.now();
    if (typeof data === 'object' && data !== null) {
      const d = data as {
        evaluation_result?: EvaluationResult;
        final_evaluation?: EvaluationResult;
        confidence?: number;
        reasoning?: string;
      };
      evaluation_result = d.evaluation_result || d.final_evaluation || 'CONDITIONAL_DENY';
      llm_reasoning = d.reasoning ?? 'No reasoning provided';
    }
    if (typeof parseTime === 'number') {
      eval_time = parseTime;
    }
    return {
      evaluation_result,
      llm_reasoning,
      model: model || 'unknown',
      evaluation_time_ms: eval_time,
    };
  }

  /**
   * フォールバック評価（従来のパース方法）
   */
  protected createFallbackEvaluation(
    rawResponse: string,
    model?: string
  ): CommonLLMEvaluationResult {
    const llmResponse = rawResponse.trim().toUpperCase();
    let evaluation_result: EvaluationResult;

    // 共通のパースロジック
    if (llmResponse.includes('ELICIT_USER_INTENT') || llmResponse.includes('user_intent_question')) {
      evaluation_result = 'NEED_MORE_INFO';
    } else if (llmResponse.includes('NEED_MORE_INFO')) {
      evaluation_result = 'NEED_MORE_INFO';
    } else if (llmResponse.includes('DENY') && !llmResponse.includes('CONDITIONAL_DENY')) {
      evaluation_result = 'DENY';
    } else if (llmResponse.includes('CONDITIONAL_DENY')) {
      evaluation_result = 'CONDITIONAL_DENY';
    } else if (llmResponse.includes('ALLOW')) {
      evaluation_result = 'ALLOW';
    } else {
      // Default to safe denial for unclear responses
      evaluation_result = 'CONDITIONAL_DENY';
      console.warn('LLM evaluation response unclear, defaulting to CONDITIONAL_DENY:', llmResponse);
    }

    return {
      evaluation_result,
      llm_reasoning: rawResponse,
      model: model || 'unknown',
      evaluation_time_ms: Date.now(),
    };
  }

  /**
   * 初回セキュリティ評価（共通実装）
   */
  async evaluateInitialSecurityByLLM(
    context: CommonEvaluationContext,
    historyContext: string[]
  ): Promise<CommonLLMEvaluationResult> {
    const promptContext = {
      command: context.command,
      commandHistory: historyContext,
      workingDirectory: context.workingDirectory,
      ...(context.comment && { comment: context.comment }),
    };

    const { systemPrompt, userMessage } =
      this.promptGenerator.generateSecurityEvaluationPrompt(promptContext);

    return this.callLLMWithStructuredOutput(
      systemPrompt,
      userMessage,
      this.responseParser.parseSecurityEvaluation,
      300,
      0.1
    );
  }

  /**
   * 簡略化されたセキュリティ評価（新しいスキーマ用）
   */
  async evaluateSimplifiedSecurityByLLM(
    context: CommonEvaluationContext,
    historyContext: string[]
  ): Promise<CommonLLMEvaluationResult> {
    const promptContext = {
      command: context.command,
      commandHistory: historyContext,
      workingDirectory: context.workingDirectory,
      ...(context.comment && { comment: context.comment }),
    };

    const { systemPrompt, userMessage } =
      this.promptGenerator.generateSecurityEvaluationPrompt(promptContext);

    return this.callLLMWithStructuredOutput(
      systemPrompt,
      userMessage,
      this.responseParser.parseSimplifiedSecurityEvaluation,
      300,
      0.1
    );
  }

  /**
   * ユーザー意図再評価（共通実装）
   */
  async evaluateWithUserIntentByLLM(
    context: CommonEvaluationContext,
    userResponse: string,
    initialEvaluation: unknown
  ): Promise<CommonLLMEvaluationResult> {
    const userIntentContext = {
      originalCommand: context.command,
      initialEvaluation,
      userResponse,
      ...(context.comment && { additionalContext: context.comment }),
    };

    const { systemPrompt, userMessage } =
      this.promptGenerator.generateUserIntentReevaluationPrompt(userIntentContext);

    return this.callLLMWithStructuredOutput(
      systemPrompt,
      userMessage,
      this.responseParser.parseUserIntentReevaluation,
      200,
      0.1
    );
  }

  /**
   * 追加コンテキスト再評価（共通実装）
   */
  async evaluateWithAdditionalContextByLLM(
    context: CommonEvaluationContext,
    additionalHistory: string[],
    initialEvaluation: unknown
  ): Promise<CommonLLMEvaluationResult> {
    const additionalContextContext = {
      originalCommand: context.command,
      initialEvaluation,
      additionalHistory,
      ...(context.comment && { environmentInfo: context.comment }),
    };

    const { systemPrompt, userMessage } =
      this.promptGenerator.generateAdditionalContextReevaluationPrompt(additionalContextContext);

    return this.callLLMWithStructuredOutput(
      systemPrompt,
      userMessage,
      this.responseParser.parseAdditionalContextReevaluation,
      200,
      0.1
    );
  }

  /**
   * エラーハンドリング用の共通評価結果生成
   */
  createErrorEvaluation(errorMessage: string, model: string = 'error'): CommonLLMEvaluationResult {
    return {
      evaluation_result: 'CONDITIONAL_DENY',
      llm_reasoning: `Evaluation failed: ${errorMessage}`,
      model,
      evaluation_time_ms: Date.now(),
    };
  }
}
