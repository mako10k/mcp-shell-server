/**
 * Security Response Parser
 * mcp-llm-generator のResponseParserパターンを参考にした
 * 安全性評価専用の型安全なStructured Output解析システム
 * BaseResponseParserを継承して重複コードを削減
 */

import { BaseResponseParser, BaseParseResult, BaseParseError } from './base-response-parser.js';
import {
  SecurityEvaluationResult,
  SecurityEvaluationResultSchema,
  UserIntentReevaluation,
  UserIntentReevaluationSchema,
  AdditionalContextReevaluation,
  AdditionalContextReevaluationSchema
} from './structured-output-schemas.js';

export interface SecurityParserConfig {
  strictMode?: boolean;
  validateSchema?: boolean;
  handleRefusal?: boolean;
  maxRetries?: number;
  fallbackOnError?: boolean;
}

export interface SecurityParseResult<T> extends BaseParseResult<T> {}
export interface SecurityParseError extends BaseParseError {}

export class SecurityResponseParser extends BaseResponseParser {
  constructor(_config: SecurityParserConfig = {
    strictMode: true,
    validateSchema: true,
    handleRefusal: true,
    maxRetries: 3,
    fallbackOnError: true
  }) {
    super();
  }

  /**
   * 初回セキュリティ評価のレスポンスを解析
   */
  async parseSecurityEvaluation(
    rawContent: string,
    requestId?: string
  ): Promise<SecurityParseResult<SecurityEvaluationResult>> {
    return this.parseWithSchema(
      rawContent,
      SecurityEvaluationResultSchema,
      requestId,
      this.validateSecurityEvaluation
    );
  }

  /**
   * ユーザ意図確認後の再評価レスポンスを解析
   */
  async parseUserIntentReevaluation(
    rawContent: string,
    requestId?: string
  ): Promise<SecurityParseResult<UserIntentReevaluation>> {
    return this.parseWithSchema(
      rawContent,
      UserIntentReevaluationSchema,
      requestId
    );
  }

  /**
   * 追加コンテキスト収集後の再評価レスポンスを解析
   */
  async parseAdditionalContextReevaluation(
    rawContent: string,
    requestId?: string
  ): Promise<SecurityParseResult<AdditionalContextReevaluation>> {
    return this.parseWithSchema(
      rawContent,
      AdditionalContextReevaluationSchema,
      requestId
    );
  }

  /**
   * セキュリティ評価の追加バリデーション
   */
  private validateSecurityEvaluation(data: unknown): { isValid: boolean; errors: SecurityParseError[] } {
    const errors: SecurityParseError[] = [];
    if (typeof data === 'object' && data !== null) {
      // 信頼度チェック
      if (typeof (data as { confidence?: number }).confidence === 'number' && ((data as { confidence: number }).confidence < 0 || (data as { confidence: number }).confidence > 1)) {
        errors.push({
          type: 'security',
          field: 'confidence',
          message: 'Confidence must be between 0 and 1',
          severity: 'error'
        });
      }

      // 評価結果とリスク要因の整合性チェック
      const evaluation_result = (data as { evaluation_result?: string }).evaluation_result;
      const risk_factors = (data as { risk_factors?: unknown[] }).risk_factors;
      if (evaluation_result === 'ALLOW' && Array.isArray(risk_factors) && risk_factors.length > 0) {
        const criticalRisks = risk_factors.filter(
          (risk) => typeof risk === 'object' && risk !== null && (risk as { severity?: string }).severity === 'critical'
        );
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
      if (evaluation_result === 'DENY' && typeof (data as { confidence?: number }).confidence === 'number' && (data as { confidence: number }).confidence < 0.7) {
        errors.push({
          type: 'security',
          field: 'confidence',
          message: 'DENY evaluation should have high confidence (>= 0.7)',
          severity: 'warning'
        });
      }
    }
    return {
      isValid: errors.filter(e => e.severity === 'error').length === 0,
      errors
    };
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
