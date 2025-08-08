/**
 * Security Evaluation Structured Output
 * mcp-llm-generator の Structured Output パターンを参考にした
 * 安全性評価専用の型安全なレスポンス定義
 */

import { z } from 'zod';

// セキュリティ評価結果のStructured Output Schema
export const SecurityEvaluationResultSchema = z.object({
  evaluation_result: z.enum([
    'ALLOW', 
    'ELICIT_USER_INTENT', 
    'NEED_MORE_INFO', 
    'CONDITIONAL_DENY', 
    'DENY'
  ]).describe('Security evaluation decision'),
  
  confidence: z.number().min(0).max(1).describe('Confidence level in the evaluation (0.0-1.0)'),
  
  reasoning: z.string().describe('Detailed reasoning for the security decision'),
  
  risk_factors: z.array(z.object({
    category: z.enum([
      'data_loss',
      'system_damage', 
      'privilege_escalation',
      'network_security',
      'user_environment',
      'unclear_intent',
      'destructive_operation'
    ]).describe('Risk category'),
    description: z.string().describe('Description of the specific risk'),
    severity: z.enum(['low', 'medium', 'high', 'critical']).describe('Risk severity level')
  })).describe('Identified security risk factors'),
  
  metadata: z.object({
    requires_additional_context: z.boolean().describe('Whether more command history/context is needed'),
    requires_user_intent: z.boolean().describe('Whether user intent clarification is needed'),
    suggested_alternatives: z.array(z.string()).describe('Safer alternative commands if available'),
    safety_level: z.number().int().min(1).max(5).describe('Safety level (1=safest, 5=most dangerous)')
  }).describe('Additional evaluation metadata')
});

// ユーザ意図確認後の再評価用Schema
export const UserIntentReevaluationSchema = z.object({
  evaluation_result: z.enum(['ALLOW', 'CONDITIONAL_DENY', 'DENY']).describe('Final evaluation after user intent'),
  confidence: z.number().min(0).max(1).describe('Confidence in evaluation with user intent'),
  reasoning: z.string().describe('Reasoning considering user intent'),
  user_intent_impact: z.object({
    changes_evaluation: z.boolean().describe('Whether user intent changes the evaluation'),
    risk_mitigation: z.string().describe('How user intent mitigates or increases risk'),
    additional_precautions: z.array(z.string()).describe('Additional precautions recommended')
  }).describe('Analysis of user intent impact on security evaluation')
});

// 追加情報収集後の再評価用Schema
export const AdditionalContextReevaluationSchema = z.object({
  evaluation_result: z.enum(['ALLOW', 'CONDITIONAL_DENY', 'DENY']).describe('Final evaluation with additional context'),
  confidence: z.number().min(0).max(1).describe('Confidence in evaluation with additional context'),
  reasoning: z.string().describe('Reasoning considering additional command history'),
  context_analysis: z.object({
    workflow_pattern: z.string().describe('Identified workflow pattern from command history'),
    risk_assessment_change: z.string().describe('How additional context changes risk assessment'),
    confidence_improvement: z.number().min(0).max(1).describe('Confidence improvement from additional context')
  }).describe('Analysis of additional context impact')
});

// Type exports
export type SecurityEvaluationResult = z.infer<typeof SecurityEvaluationResultSchema>;
export type UserIntentReevaluation = z.infer<typeof UserIntentReevaluationSchema>;
export type AdditionalContextReevaluation = z.infer<typeof AdditionalContextReevaluationSchema>;

// エラーハンドリング用Schema
export const SecurityEvaluationErrorSchema = z.object({
  error_type: z.enum(['llm_failure', 'parsing_error', 'validation_error', 'timeout']).describe('Type of error'),
  error_message: z.string().describe('Error description'),
  fallback_evaluation: z.enum(['CONDITIONAL_DENY', 'DENY']).describe('Safe fallback evaluation'),
  timestamp: z.string().describe('Error timestamp')
});

export type SecurityEvaluationError = z.infer<typeof SecurityEvaluationErrorSchema>;

// Parse結果のWrapper
export interface SecurityParseResult<T> {
  success: boolean;
  data?: T;
  errors?: SecurityParseError[];
  metadata: {
    rawContent: string;
    parseTime: number;
    confidence: number;
    retryCount: number;
  };
}

export interface SecurityParseError {
  type: 'validation' | 'format' | 'schema' | 'security';
  field?: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

// Function Call 模倣用のTool定義
export const SecurityEvaluationToolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.literal('evaluate_command_security'),
    description: z.string(),
    parameters: z.object({
      type: z.literal('object'),
      properties: z.object({
        evaluation_result: SecurityEvaluationResultSchema.shape.evaluation_result,
        confidence: SecurityEvaluationResultSchema.shape.confidence,
        reasoning: SecurityEvaluationResultSchema.shape.reasoning,
        risk_factors: SecurityEvaluationResultSchema.shape.risk_factors,
        metadata: SecurityEvaluationResultSchema.shape.metadata
      }),
      required: z.array(z.literal('evaluation_result')).default(['evaluation_result']),
      additionalProperties: z.literal(false)
    })
  })
});

export type SecurityEvaluationTool = z.infer<typeof SecurityEvaluationToolSchema>;
