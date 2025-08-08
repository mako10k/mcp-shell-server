/**
 * Security Response Parser
 * mcp-llm-generator のResponseParserパターンを参考にした
 * 安全性評価専用の型安全なStructured Output解析システム
 */

import { z } from 'zod';
import {
  SecurityEvaluationResult,
  SecurityEvaluationResultSchema,
  UserIntentReevaluation,
  UserIntentReevaluationSchema,
  AdditionalContextReevaluation,
  AdditionalContextReevaluationSchema,
  SecurityParseResult,
  SecurityParseError
} from './structured-output-schemas.js';

export interface SecurityParserConfig {
  strictMode?: boolean;
  validateSchema?: boolean;
  handleRefusal?: boolean;
  maxRetries?: number;
  fallbackOnError?: boolean;
}

export class SecurityResponseParser {
  private parseAttempts: Map<string, number> = new Map();

  constructor(_config: SecurityParserConfig = {
    strictMode: true,
    validateSchema: true,
    handleRefusal: true,
    maxRetries: 3,
    fallbackOnError: true
  }) {
    // configは必要時にmethodで使用可能
  }

  /**
   * 初回セキュリティ評価のレスポンスを解析
   */
  async parseSecurityEvaluation(
    rawContent: string,
    requestId?: string
  ): Promise<SecurityParseResult<SecurityEvaluationResult>> {
    const startTime = Date.now();
    const retryCount = this.getRetryCount(requestId);
    
    try {
      // JSON抽出とパース
      const extractedJson = this.extractJsonFromResponse(rawContent);
      if (!extractedJson) {
        return this.createErrorResult(
          rawContent,
          startTime,
          retryCount,
          'format',
          'No valid JSON found in response'
        );
      }

      // Zodスキーマでバリデーション
      const parsed = SecurityEvaluationResultSchema.safeParse(extractedJson);
      
      if (!parsed.success) {
        // バリデーションエラーの詳細解析
        const errors = this.parseValidationErrors(parsed.error);
        return this.createErrorResult(
          rawContent,
          startTime,
          retryCount,
          'validation',
          'Schema validation failed',
          errors
        );
      }

      // 成功時の追加バリデーション
      const validationResult = this.validateSecurityEvaluation(parsed.data);
      if (!validationResult.isValid) {
        return this.createErrorResult(
          rawContent,
          startTime,
          retryCount,
          'security',
          'Security validation failed',
          validationResult.errors
        );
      }

      return {
        success: true,
        data: parsed.data,
        metadata: {
          rawContent,
          parseTime: Date.now() - startTime,
          confidence: this.calculateConfidence(parsed.data, rawContent),
          retryCount
        }
      };

    } catch (error) {
      return this.createErrorResult(
        rawContent,
        startTime,
        retryCount,
        'format',
        `Parse error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * ユーザ意図確認後の再評価レスポンスを解析
   */
  async parseUserIntentReevaluation(
    rawContent: string,
    requestId?: string
  ): Promise<SecurityParseResult<UserIntentReevaluation>> {
    const startTime = Date.now();
    const retryCount = this.getRetryCount(requestId);
    
    try {
      const extractedJson = this.extractJsonFromResponse(rawContent);
      if (!extractedJson) {
        return this.createErrorResult(
          rawContent,
          startTime,
          retryCount,
          'format',
          'No valid JSON found in response'
        );
      }

      const parsed = UserIntentReevaluationSchema.safeParse(extractedJson);
      
      if (!parsed.success) {
        const errors = this.parseValidationErrors(parsed.error);
        return this.createErrorResult(
          rawContent,
          startTime,
          retryCount,
          'validation',
          'Schema validation failed',
          errors
        );
      }

      return {
        success: true,
        data: parsed.data,
        metadata: {
          rawContent,
          parseTime: Date.now() - startTime,
          confidence: this.calculateConfidence(parsed.data, rawContent),
          retryCount
        }
      };

    } catch (error) {
      return this.createErrorResult(
        rawContent,
        startTime,
        retryCount,
        'format',
        `Parse error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * 追加コンテキスト収集後の再評価レスポンスを解析
   */
  async parseAdditionalContextReevaluation(
    rawContent: string,
    requestId?: string
  ): Promise<SecurityParseResult<AdditionalContextReevaluation>> {
    const startTime = Date.now();
    const retryCount = this.getRetryCount(requestId);
    
    try {
      const extractedJson = this.extractJsonFromResponse(rawContent);
      if (!extractedJson) {
        return this.createErrorResult(
          rawContent,
          startTime,
          retryCount,
          'format',
          'No valid JSON found in response'
        );
      }

      const parsed = AdditionalContextReevaluationSchema.safeParse(extractedJson);
      
      if (!parsed.success) {
        const errors = this.parseValidationErrors(parsed.error);
        return this.createErrorResult(
          rawContent,
          startTime,
          retryCount,
          'validation',
          'Schema validation failed',
          errors
        );
      }

      return {
        success: true,
        data: parsed.data,
        metadata: {
          rawContent,
          parseTime: Date.now() - startTime,
          confidence: this.calculateConfidence(parsed.data, rawContent),
          retryCount
        }
      };

    } catch (error) {
      return this.createErrorResult(
        rawContent,
        startTime,
        retryCount,
        'format',
        `Parse error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * レスポンスからJSONを抽出
   */
  private extractJsonFromResponse(rawContent: string): any {
    try {
      // 直接JSONとしてパース試行
      return JSON.parse(rawContent.trim());
    } catch {
      // JSONブロックを抽出して試行
      const jsonMatch = rawContent.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch && jsonMatch[1]) {
        try {
          return JSON.parse(jsonMatch[1]);
        } catch {
          // JSONブロック内のパースに失敗
        }
      }

      // { } で囲まれた部分を抽出
      const braceMatch = rawContent.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        try {
          return JSON.parse(braceMatch[0]);
        } catch {
          // ブレース部分のパースに失敗
        }
      }

      return null;
    }
  }

  /**
   * Zodバリデーションエラーを解析
   */
  private parseValidationErrors(zodError: z.ZodError): SecurityParseError[] {
    return zodError.issues.map(issue => ({
      type: 'validation',
      field: issue.path.join('.'),
      message: issue.message,
      severity: 'error'
    }));
  }

  /**
   * セキュリティ評価の追加バリデーション
   */
  private validateSecurityEvaluation(data: any): { isValid: boolean; errors: SecurityParseError[] } {
    const errors: SecurityParseError[] = [];

    // 信頼度チェック
    if (typeof data.confidence === 'number' && (data.confidence < 0 || data.confidence > 1)) {
      errors.push({
        type: 'security',
        field: 'confidence',
        message: 'Confidence must be between 0 and 1',
        severity: 'error'
      });
    }

    // 評価結果とリスク要因の整合性チェック
    if (data.evaluation_result === 'ALLOW' && data.risk_factors && data.risk_factors.length > 0) {
      const criticalRisks = data.risk_factors.filter((risk: any) => risk.severity === 'critical');
      if (criticalRisks.length > 0) {
        errors.push({
          type: 'security',
          field: 'evaluation_result',
          message: 'ALLOW evaluation should not have critical risk factors',
          severity: 'warning'
        });
      }
    }

    // DENY評価の信頼度チェック
    if (data.evaluation_result === 'DENY' && data.confidence < 0.7) {
      errors.push({
        type: 'security',
        field: 'confidence',
        message: 'DENY evaluation should have high confidence (>= 0.7)',
        severity: 'warning'
      });
    }

    return {
      isValid: errors.filter(e => e.severity === 'error').length === 0,
      errors
    };
  }

  /**
   * 信頼度計算
   */
  private calculateConfidence(data: any, rawContent: string): number {
    let confidence = 0.8; // ベース信頼度

    // JSON構造の明確さ
    if (rawContent.includes('```json')) {
      confidence += 0.1;
    }

    // データの完全性
    if (data.reasoning && data.reasoning.length > 10) {
      confidence += 0.05;
    }

    if (data.risk_factors && Array.isArray(data.risk_factors)) {
      confidence += 0.05;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * エラー結果を作成
   */
  private createErrorResult<T>(
    rawContent: string,
    startTime: number,
    retryCount: number,
    errorType: SecurityParseError['type'],
    message: string,
    additionalErrors: SecurityParseError[] = []
  ): SecurityParseResult<T> {
    const errors: SecurityParseError[] = [
      {
        type: errorType,
        message,
        severity: 'error'
      },
      ...additionalErrors
    ];

    return {
      success: false,
      errors,
      metadata: {
        rawContent,
        parseTime: Date.now() - startTime,
        confidence: 0.0,
        retryCount
      }
    };
  }

  /**
   * リトライ回数取得
   */
  private getRetryCount(requestId?: string): number {
    if (!requestId) return 0;
    
    const count = this.parseAttempts.get(requestId) || 0;
    this.parseAttempts.set(requestId, count + 1);
    return count;
  }

  /**
   * フォールバック評価を生成
   */
  createFallbackEvaluation(error: string): SecurityEvaluationResult {
    return {
      evaluation_result: 'CONDITIONAL_DENY',
      confidence: 0.3,
      reasoning: `LLM response parsing failed: ${error}. Defaulting to safe evaluation requiring user confirmation.`,
      risk_factors: [
        {
          category: 'unclear_intent',
          description: 'Unable to properly evaluate command due to parsing failure',
          severity: 'medium'
        }
      ],
      metadata: {
        requires_additional_context: false,
        requires_user_intent: false,
        suggested_alternatives: [],
        safety_level: 3
      }
    };
  }
}
