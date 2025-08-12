/**
 * Security Response Parser
 * Based on ResponseParser pattern from mcp-llm-generator
 * Type-safe structured output parsing system dedicated to security evaluation
 * Inherits from BaseResponseParser to reduce code duplication
 */

import { BaseResponseParser, BaseParseResult, BaseParseError } from './base-response-parser.js';
import {
  SecurityEvaluationResult,
  SecurityEvaluationResultSchema,
  SimplifiedSecurityEvaluationResult,
  SimplifiedSecurityEvaluationResultSchema,
  UserIntentReevaluation,
  UserIntentReevaluationSchema,
  AdditionalContextReevaluation,
  AdditionalContextReevaluationSchema,
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
  constructor(
    _config: SecurityParserConfig = {
      strictMode: true,
      validateSchema: true,
      handleRefusal: true,
      maxRetries: 3,
      fallbackOnError: true,
    }
  ) {
    super();
  }

  /**
   * Parse initial security evaluation response
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
   * Parse simplified security evaluation response (new schema)
   */
  async parseSimplifiedSecurityEvaluation(
    rawContent: string,
    requestId?: string
  ): Promise<SecurityParseResult<SimplifiedSecurityEvaluationResult>> {
    return this.parseWithSchema(
      rawContent,
      SimplifiedSecurityEvaluationResultSchema,
      requestId,
      this.validateSimplifiedSecurityEvaluation
    );
  }

  /**
   * Parse re-evaluation response after user intent confirmation
   */
  async parseUserIntentReevaluation(
    rawContent: string,
    requestId?: string
  ): Promise<SecurityParseResult<UserIntentReevaluation>> {
    return this.parseWithSchema(rawContent, UserIntentReevaluationSchema, requestId);
  }

  /**
   * Parse re-evaluation response after additional context collection
   */
  async parseAdditionalContextReevaluation(
    rawContent: string,
    requestId?: string
  ): Promise<SecurityParseResult<AdditionalContextReevaluation>> {
    return this.parseWithSchema(rawContent, AdditionalContextReevaluationSchema, requestId);
  }

  /**
   * Additional validation for simplified security evaluation
   */
  private validateSimplifiedSecurityEvaluation(data: unknown): {
    isValid: boolean;
    errors: SecurityParseError[];
  } {
    const errors: SecurityParseError[] = [];
    if (typeof data === 'object' && data !== null) {
      const evalData = data as SimplifiedSecurityEvaluationResult;
      
      // requires_additional_context の整合性チェック
      if (evalData.requires_additional_context) {
        const ctx = evalData.requires_additional_context;
        
        // 数値の範囲チェック
        if (ctx.command_history_depth < 0) {
          errors.push({
            type: 'security',
            field: 'requires_additional_context.command_history_depth',
            message: 'command_history_depth must be non-negative',
            severity: 'error',
          });
        }
        
        if (ctx.execution_results_count < 0) {
          errors.push({
            type: 'security',
            field: 'requires_additional_context.execution_results_count',
            message: 'execution_results_count must be non-negative',
            severity: 'error',
          });
        }
        
        // user_intent_question と evaluation_result の整合性
        if (ctx.user_intent_question && evalData.evaluation_result === 'ALLOW') {
          errors.push({
            type: 'security',
            field: 'requires_additional_context.user_intent_question',
            message: 'ALLOW evaluation should not require user intent clarification',
            severity: 'warning',
          });
        }
      }
    }
    return {
      isValid: errors.filter((e) => e.severity === 'error').length === 0,
      errors,
    };
  }

  /**
   * Additional validation for security evaluation
   */
  private validateSecurityEvaluation(data: unknown): {
    isValid: boolean;
    errors: SecurityParseError[];
  } {
    const errors: SecurityParseError[] = [];
    if (typeof data === 'object' && data !== null) {
      // 信頼度チェック
      if (
        typeof (data as { confidence?: number }).confidence === 'number' &&
        ((data as { confidence: number }).confidence < 0 ||
          (data as { confidence: number }).confidence > 1)
      ) {
        errors.push({
          type: 'security',
          field: 'confidence',
          message: 'Confidence must be between 0 and 1',
          severity: 'error',
        });
      }

      // Consistency check between evaluation result and risk factors
      const evaluation_result = (data as { evaluation_result?: string }).evaluation_result;
      const risk_factors = (data as { risk_factors?: unknown[] }).risk_factors;
      if (evaluation_result === 'ALLOW' && Array.isArray(risk_factors) && risk_factors.length > 0) {
        const criticalRisks = risk_factors.filter(
          (risk) =>
            typeof risk === 'object' &&
            risk !== null &&
            (risk as { severity?: string }).severity === 'critical'
        );
        if (criticalRisks.length > 0) {
          errors.push({
            type: 'security',
            field: 'evaluation_result',
            message: 'ALLOW evaluation should not have critical risk factors',
            severity: 'warning',
          });
        }
      }

      // DENY evaluation confidence check
      if (
        evaluation_result === 'DENY' &&
        typeof (data as { confidence?: number }).confidence === 'number' &&
        (data as { confidence: number }).confidence < 0.7
      ) {
        errors.push({
          type: 'security',
          field: 'confidence',
          message: 'DENY evaluation should have high confidence (>= 0.7)',
          severity: 'warning',
        });
      }
    }
    return {
      isValid: errors.filter((e) => e.severity === 'error').length === 0,
      errors,
    };
  }

  /**
   * Generate fallback evaluation
   */
}
