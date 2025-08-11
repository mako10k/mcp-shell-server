/**
 * Base Response Parser for Common Parsing Logic
 * SecurityResponseParserの重複コードを共通化
 */

import { z } from 'zod';

export interface BaseParseResult<T> {
  success: boolean;
  data?: T;
  errors?: BaseParseError[];
  metadata: {
    rawContent: string;
    parseTime: number;
    confidence: number;
    retryCount: number;
  };
}

export interface BaseParseError {
  type: 'validation' | 'format' | 'security';
  field?: string;
  message: string;
  severity: 'error' | 'warning';
}

export abstract class BaseResponseParser {
  private parseAttempts: Map<string, number> = new Map();

  /**
   * 共通の解析ロジック
   */
  protected async parseWithSchema<T>(
    rawContent: string,
    schema: z.ZodSchema<T>,
    requestId?: string,
    validator?: (data: T) => { isValid: boolean; errors: BaseParseError[] }
  ): Promise<BaseParseResult<T>> {
    const startTime = Date.now();
    const retryCount = this.getRetryCount(requestId);

    try {
      // JSON抽出とパース
      const extractedJson = this.extractJsonFromResponse(rawContent);
      if (!extractedJson) {
        return this.createErrorResult<T>(
          rawContent,
          startTime,
          retryCount,
          'format',
          'No valid JSON found in response'
        );
      }

      // Zodスキーマでバリデーション
      const parsed = schema.safeParse(extractedJson);

      if (!parsed.success) {
        const errors = this.parseValidationErrors(parsed.error);
        return this.createErrorResult<T>(
          rawContent,
          startTime,
          retryCount,
          'validation',
          'Schema validation failed',
          errors
        );
      }

      // カスタムバリデーション
      if (validator) {
        const validationResult = validator(parsed.data);
        if (!validationResult.isValid) {
          return this.createErrorResult<T>(
            rawContent,
            startTime,
            retryCount,
            'security',
            'Custom validation failed',
            validationResult.errors
          );
        }
      }

      return {
        success: true,
        data: parsed.data,
        metadata: {
          rawContent,
          parseTime: Date.now() - startTime,
          confidence: this.calculateConfidence(parsed.data, rawContent),
          retryCount,
        },
      };
    } catch (error) {
      return this.createErrorResult<T>(
        rawContent,
        startTime,
        retryCount,
        'format',
        `Parse error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * レスポンスからJSONを抽出（共通ロジック）
   */
  protected extractJsonFromResponse(rawContent: string): unknown {
    try {
      // 直接JSONとしてパース試行
      return JSON.parse(rawContent.trim());
    } catch {
      // JSONブロックを抽出して試行
      const jsonMatch = rawContent.match(/```json\n([\\s\\S]*?)\n```/);
      if (jsonMatch && jsonMatch[1]) {
        try {
          return JSON.parse(jsonMatch[1]);
        } catch {
          // JSONブロック内のパースに失敗
        }
      }

      // { } で囲まれた部分を抽出
      const braceMatch = rawContent.match(/\\{[\\s\\S]*\\}/);
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
   * Zodバリデーションエラーを解析（共通ロジック）
   */
  protected parseValidationErrors(zodError: z.ZodError): BaseParseError[] {
    return zodError.issues.map((issue) => ({
      type: 'validation' as const,
      field: issue.path.join('.'),
      message: issue.message,
      severity: 'error' as const,
    }));
  }

  /**
   * 信頼度計算（共通ロジック）
   */
  protected calculateConfidence(data: unknown, rawContent: string): number {
    let confidence = 0.8; // ベース信頼度

    // JSON構造の明確さ
    if (rawContent.includes('```json')) {
      confidence += 0.1;
    }

    // データの完全性（型ガードで安全にアクセス）
    if (
      typeof data === 'object' &&
      data !== null &&
      'reasoning' in data &&
      Array.isArray((data as { risk_factors?: unknown }).risk_factors)
    ) {
      const reasoning = (data as { reasoning?: string }).reasoning;
      if (typeof reasoning === 'string' && reasoning.length > 10) {
        confidence += 0.05;
      }
      confidence += 0.05;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * エラー結果を作成（共通ロジック）
   */
  protected createErrorResult<T>(
    rawContent: string,
    startTime: number,
    retryCount: number,
    errorType: BaseParseError['type'],
    message: string,
    additionalErrors: BaseParseError[] = []
  ): BaseParseResult<T> {
    const errors: BaseParseError[] = [
      {
        type: errorType,
        message,
        severity: 'error',
      },
      ...additionalErrors,
    ];

    return {
      success: false,
      errors,
      metadata: {
        rawContent,
        parseTime: Date.now() - startTime,
        confidence: 0.0,
        retryCount,
      },
    };
  }

  /**
   * リトライ回数取得（共通ロジック）
   */
  protected getRetryCount(requestId?: string): number {
    if (!requestId) return 0;

    const count = this.parseAttempts.get(requestId) || 0;
    this.parseAttempts.set(requestId, count + 1);
    return count;
  }
}
