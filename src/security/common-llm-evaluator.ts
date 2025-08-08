/**
 * Common LLM Evaluation Base Class
 * Structured Output対応の共通評価ロジックを提供
 * enhanced-evaluator.tsの重複コードを共通化
 */

import { EvaluationResult } from '../types/enhanced-security.js';
import { SecurityResponseParser } from './security-response-parser.js';
import { SecurityLLMPromptGenerator } from './security-llm-prompt-generator.js';

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

// 共通の評価結果インターフェース
export interface CommonLLMEvaluationResult {
  evaluation_result: EvaluationResult;
  confidence: number;
  llm_reasoning: string;
  model: string;
  evaluation_time_ms: number;
}

// 共通の評価コンテキスト
export interface CommonEvaluationContext {
  command: string;
  workingDirectory: string;
  comment?: string;
  additionalContext?: Record<string, any>;
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
    parserMethod: (content: string, requestId: string) => Promise<{ success: boolean; data?: T; errors?: any; metadata: any }>,
    maxTokens: number = 200,
    temperature: number = 0.1
  ): Promise<CommonLLMEvaluationResult> {
    try {
      const response = await this.createMessageCallback({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: userMessage
            }
          }
        ],
        maxTokens,
        temperature,
        systemPrompt,
        includeContext: 'none'
      });

      // Structured Output解析を試行
      const requestId = `eval_${Date.now()}`;
      const parseResult = await parserMethod.call(this.responseParser, response.content.text, requestId);

      if (parseResult.success && parseResult.data) {
        return this.extractEvaluationFromStructuredResult(parseResult.data, response.model, parseResult.metadata.parseTime);
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
  private extractEvaluationFromStructuredResult(data: any, model?: string, parseTime?: number): CommonLLMEvaluationResult {
    return {
      evaluation_result: data.evaluation_result || data.final_evaluation,
      confidence: data.confidence || 0.5,
      llm_reasoning: data.reasoning || 'No reasoning provided',
      model: model || 'unknown',
      evaluation_time_ms: parseTime || Date.now()
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
    let confidence = 0.8;

    // 共通のパースロジック
    if (llmResponse.includes('ELICIT_USER_INTENT')) {
      evaluation_result = 'ELICIT_USER_INTENT';
      confidence = 0.6;
    } else if (llmResponse.includes('NEED_MORE_INFO')) {
      evaluation_result = 'NEED_MORE_INFO';
      confidence = 0.6;
    } else if (llmResponse.includes('DENY') && !llmResponse.includes('CONDITIONAL_DENY')) {
      evaluation_result = 'DENY';
      confidence = 0.9;
    } else if (llmResponse.includes('CONDITIONAL_DENY')) {
      evaluation_result = 'CONDITIONAL_DENY';
      confidence = 0.8;
    } else if (llmResponse.includes('ALLOW')) {
      evaluation_result = 'ALLOW';
      confidence = 0.9;
    } else {
      // Default to safe denial for unclear responses
      evaluation_result = 'CONDITIONAL_DENY';
      confidence = 0.3;
      console.warn('LLM evaluation response unclear, defaulting to CONDITIONAL_DENY:', llmResponse);
    }

    return {
      evaluation_result,
      confidence,
      llm_reasoning: rawResponse,
      model: model || 'unknown',
      evaluation_time_ms: Date.now()
    };
  }

  /**
   * 初回セキュリティ評価（共通実装）
   */
  async evaluateInitialSecurity(context: CommonEvaluationContext, historyContext: string[]): Promise<CommonLLMEvaluationResult> {
    const promptContext = {
      command: context.command,
      commandHistory: historyContext,
      workingDirectory: context.workingDirectory,
      ...(context.comment && { comment: context.comment })
    };

    const { systemPrompt, userMessage } = this.promptGenerator.generateSecurityEvaluationPrompt(promptContext);

    return this.callLLMWithStructuredOutput(
      systemPrompt,
      userMessage,
      this.responseParser.parseSecurityEvaluation,
      300,
      0.1
    );
  }

  /**
   * ユーザー意図再評価（共通実装）
   */
  async evaluateWithUserIntent(
    context: CommonEvaluationContext,
    userResponse: string,
    initialEvaluation: any
  ): Promise<CommonLLMEvaluationResult> {
    const userIntentContext = {
      originalCommand: context.command,
      initialEvaluation,
      userResponse,
      ...(context.comment && { additionalContext: context.comment })
    };

    const { systemPrompt, userMessage } = this.promptGenerator.generateUserIntentReevaluationPrompt(userIntentContext);

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
  async evaluateWithAdditionalContext(
    context: CommonEvaluationContext,
    additionalHistory: string[],
    initialEvaluation: any
  ): Promise<CommonLLMEvaluationResult> {
    const additionalContextContext = {
      originalCommand: context.command,
      initialEvaluation,
      additionalHistory,
      ...(context.comment && { environmentInfo: context.comment })
    };

    const { systemPrompt, userMessage } = this.promptGenerator.generateAdditionalContextReevaluationPrompt(additionalContextContext);

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
      confidence: 0.2,
      llm_reasoning: `Evaluation failed: ${errorMessage}`,
      model,
      evaluation_time_ms: Date.now()
    };
  }
}
