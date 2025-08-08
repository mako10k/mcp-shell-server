/**
 * Structured Output Schemas for Security Evaluation
 * mcp-llm-generatorパターンに基づくZodスキーマ定義
 * BaseResponseParserと統合された型定義
 */

import { z } from 'zod';
import { BaseParseResult, BaseParseError } from './base-response-parser.js';

// Security-specific types that extend base types
export interface SecurityParseResult<T> extends BaseParseResult<T> {}
export interface SecurityParseError extends BaseParseError {}

// Risk factor schema
const RiskFactorSchema = z.object({
  category: z.enum(['destructive_action', 'data_access', 'network_access', 'system_modification', 'unclear_intent', 'suspicious_pattern']),
  description: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical'])
});

// Metadata schema
const SecurityMetadataSchema = z.object({
  requires_additional_context: z.boolean(),
  requires_user_intent: z.boolean(),
  suggested_alternatives: z.array(z.string()),
  safety_level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
});

// Main security evaluation result schema
export const SecurityEvaluationResultSchema = z.object({
  evaluation_result: z.enum(['ALLOW', 'CONDITIONAL_DENY', 'DENY', 'ELICIT_USER_INTENT', 'NEED_MORE_INFO']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  risk_factors: z.array(RiskFactorSchema).optional(),
  metadata: SecurityMetadataSchema
});

// User intent impact schema
const UserIntentImpactSchema = z.object({
  changes_evaluation: z.boolean(),
  risk_mitigation: z.string(),
  additional_precautions: z.array(z.string())
});

// User intent reevaluation schema
export const UserIntentReevaluationSchema = z.object({
  evaluation_result: z.enum(['ALLOW', 'CONDITIONAL_DENY', 'DENY']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  user_intent_impact: UserIntentImpactSchema
});

// Context analysis schema
const ContextAnalysisSchema = z.object({
  additional_context_helpful: z.boolean(),
  context_changes_risk: z.boolean(),
  pattern_identified: z.string().nullable()
});

// Comprehensive risk factor schema with context
const ComprehensiveRiskFactorSchema = RiskFactorSchema.extend({
  context_informed: z.boolean()
});

// Additional context metadata schema
const AdditionalContextMetadataSchema = z.object({
  safety_level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  monitoring_required: z.boolean(),
  context_quality: z.enum(['low', 'medium', 'high']),
  final_recommendations: z.array(z.string())
});

// Additional context reevaluation schema
export const AdditionalContextReevaluationSchema = z.object({
  evaluation_result: z.enum(['ALLOW', 'CONDITIONAL_DENY', 'DENY']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  context_analysis: ContextAnalysisSchema,
  comprehensive_risk_factors: z.array(ComprehensiveRiskFactorSchema),
  metadata: AdditionalContextMetadataSchema
});

// Export TypeScript types
export type SecurityEvaluationResult = z.infer<typeof SecurityEvaluationResultSchema>;
export type UserIntentReevaluation = z.infer<typeof UserIntentReevaluationSchema>;
export type AdditionalContextReevaluation = z.infer<typeof AdditionalContextReevaluationSchema>;
export type RiskFactor = z.infer<typeof RiskFactorSchema>;
export type SecurityMetadata = z.infer<typeof SecurityMetadataSchema>;
