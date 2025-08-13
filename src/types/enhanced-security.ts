import { z } from 'zod';

// Enhanced Security Configuration for MCP Shell Server Safety Features
// Based on the requirements specification in docs/new_requirements.md

// 安全性レベル (1=最も安全, 5=最も危険)
export const SafetyLevelSchema = z
  .number()
  .int()
  .min(1)
  .max(5)
  .describe('Safety level from 1 (safest) to 5 (most dangerous)');
export type SafetyLevel = z.infer<typeof SafetyLevelSchema>;

// 評価結果 (Tool-based evaluation system)
export const EvaluationResultSchema = z
  .enum(['allow', 'deny', 'add_more_history', 'user_confirm', 'ai_assistant_confirm'])
  .describe('Tool-based evaluation result for security assessment');

export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

// 従来のLLM評価結果スキーマ (backward compatibility - 統一されました)
export const SimplifiedLLMEvaluationResultSchema = z.object({
  evaluation_result: EvaluationResultSchema,
  reasoning: z.string(),
  requires_additional_context: z.object({
    command_history_depth: z.number().int().min(0),
    execution_results_count: z.number().int().min(0), 
    user_intent_search_keywords: z.array(z.string()).nullable(),
    user_intent_question: z.string().nullable()
  }),
  suggested_alternatives: z.array(z.string())
});

export type SimplifiedLLMEvaluationResult = z.infer<typeof SimplifiedLLMEvaluationResultSchema>;

// コマンド分類
export const CommandClassificationSchema = z
  .enum(['basic_safe', 'llm_required'])
  .describe('Command safety classification');
export type CommandClassification = z.infer<typeof CommandClassificationSchema>;

// Enhanced Security Configuration
export const EnhancedSecurityConfigSchema = z
  .object({
    // 機能切り替え (LLM中心設計)
    enhanced_mode_enabled: z.boolean().default(true).describe('Enable enhanced security features'),
    basic_safe_classification: z
      .boolean()
      .default(true)
      .describe('Enable basic safe command classification'),
    llm_evaluation_enabled: z
      .boolean()
      .default(true)
      .describe('Enable LLM-based command evaluation (LLM-centric design)'),
    elicitation_enabled: z.boolean().default(true).describe('Enable user intent elicitation'),
    enable_pattern_filtering: z
      .boolean()
      .default(false)
      .describe(
        'Enable pattern-based pre-filtering (default: false - all commands go to LLM evaluation)'
      ),

    // LLM中心設計用の設定
    disable_algorithmic_preprocessing: z
      .boolean()
      .default(true)
      .describe('Disable complex algorithmic analysis to avoid confusing LLM'),
    max_additional_history_for_context: z
      .number()
      .int()
      .min(5)
      .max(50)
      .default(20)
      .describe('Maximum additional history entries when LLM requests NEED_MORE_HISTORY'),
    enable_command_output_context: z
      .boolean()
      .default(true)
      .describe('Allow LLM to request command output summaries for context'),

    // 履歴管理
    command_history_enhanced: z
      .boolean()
      .default(true)
      .describe('Enable enhanced command history management'),
    history_retention_days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .describe('Command history retention period in days'),
    max_history_entries: z
      .number()
      .int()
      .min(100)
      .max(10000)
      .default(1000)
      .describe('Maximum number of history entries to keep'),

    // LLM設定
    llm_provider: z
      .enum(['openai', 'anthropic', 'custom'])
      .default('openai')
      .describe('LLM provider for command evaluation'),
    llm_api_key: z.string().optional().describe('API key for LLM provider'),
    llm_model: z.string().default('gpt-4').describe('LLM model to use for evaluation'),
    llm_timeout_seconds: z
      .number()
      .int()
      .min(1)
      .max(60)
      .default(3)
      .describe('LLM evaluation timeout in seconds'),

    // 学習機能
    enable_resubmission_learning: z
      .boolean()
      .default(true)
      .describe('Enable learning from command resubmissions'),
    max_resubmission_attempts: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(3)
      .describe('Maximum resubmission attempts'),

    // 安全性閾値
    safety_level_thresholds: z
      .object({
        require_confirmation: z
          .number()
          .int()
          .min(1)
          .max(5)
          .default(4)
          .describe('Safety level that requires user confirmation'),
        auto_deny: z
          .number()
          .int()
          .min(1)
          .max(5)
          .default(5)
          .describe('Safety level that results in automatic denial'),
      })
      .describe('Safety level thresholds for different actions'),
  })
  .describe('Enhanced security configuration for MCP Shell Server');

export type EnhancedSecurityConfig = z.infer<typeof EnhancedSecurityConfigSchema>;

// コマンド履歴エントリ (拡張版)
export const CommandHistoryEntrySchema = z
  .object({
    execution_id: z.string().describe('Unique execution identifier'),
    command: z.string().describe('Executed command'),
    timestamp: z.string().describe('Execution timestamp'),
    working_directory: z.string().describe('Working directory at execution time'),

    // 評価結果（新規）
    safety_classification: CommandClassificationSchema.optional().describe(
      'Basic safety classification'
    ),
    llm_evaluation_result: EvaluationResultSchema.optional().describe('LLM evaluation result'),
    evaluation_reasoning: z.string().optional().describe('Reasoning for the evaluation'),
    denial_context: z.string().optional().describe('Context and suggestions for denied commands'),

    // ユーザ確認履歴（新規）
    user_confirmation_context: z
      .object({
        prompt: z.string().describe('Confirmation prompt shown to user'),
        user_response: z.boolean().describe('User confirmation response'),
        user_reasoning: z.string().optional().describe('User provided reasoning'),
        timestamp: z.string().describe('Confirmation timestamp'),
        confidence_level: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe('User confidence level'),
      })
      .optional()
      .describe('User confirmation context if confirmation was required'),

    // 実行結果
    was_executed: z.boolean().describe('Whether the command was actually executed'),
    execution_status: z.string().optional().describe('Execution status if executed'),
    resubmission_count: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('Number of times command was resubmitted'),
    output_summary: z.string().optional().describe('Summary of command output'),
  })
  .describe('Enhanced command history entry');

export type CommandHistoryEntry = z.infer<typeof CommandHistoryEntrySchema>;

// ユーザ確認パターン
export const UserConfirmationPatternSchema = z
  .object({
    command_pattern: z.string().describe('Command pattern regex or semantic description'),
    confirmation_rate: z
      .number()
      .min(0)
      .max(1)
      .describe('Rate of user confirmations for this pattern (0-1)'),
    typical_reasoning: z.array(z.string()).describe('Common user reasoning for this pattern'),
    confidence: z.number().min(0).max(1).describe('Confidence in this pattern (0-1)'),
  })
  .describe('User confirmation pattern for intent prediction');

export type UserConfirmationPattern = z.infer<typeof UserConfirmationPatternSchema>;

// 基本安全分類ルール
export const BasicSafetyRuleSchema = z
  .object({
    pattern: z.string().describe('Regular expression pattern'),
    reasoning: z.string().describe('Human-readable reasoning for this rule'),
    safety_level: SafetyLevelSchema.describe(
      'Safety level assigned to commands matching this pattern'
    ),
  })
  .describe('Basic safety classification rule');

export type BasicSafetyRule = z.infer<typeof BasicSafetyRuleSchema>;

// 設定ファイル全体の型定義
export const ShellServerConfigSchema = z
  .object({
    // 既存の設定は維持
    server: z
      .object({
        name: z.string().default('MCP Shell Server'),
        version: z.string().default('2.2.0'),
      })
      .optional(),

    // 新規: Enhanced Security設定
    enhanced_security: EnhancedSecurityConfigSchema.optional(),

    // 新規: 基本安全分類ルール
    basic_safety_rules: z
      .array(BasicSafetyRuleSchema)
      .optional()
      .describe('Custom basic safety classification rules'),
  })
  .describe('Complete MCP Shell Server configuration');

export type ShellServerConfig = z.infer<typeof ShellServerConfigSchema>;

// デフォルト設定 (LLM中心設計)
export const DEFAULT_ENHANCED_SECURITY_CONFIG: EnhancedSecurityConfig = {
  enhanced_mode_enabled: true,  // Enhanced Evaluatorを使用するため有効化
  basic_safe_classification: true,
  llm_evaluation_enabled: true, // LLM中心設計: デフォルトでLLM評価有効
  elicitation_enabled: true, // LLM中心設計: デフォルトでElicitation有効
  enable_pattern_filtering: false, // LLM中心設計: デフォルトで全コマンドLLM評価
  disable_algorithmic_preprocessing: true,
  max_additional_history_for_context: 20,
  enable_command_output_context: true,

  command_history_enhanced: true,
  history_retention_days: 30,
  max_history_entries: 1000,
  llm_provider: 'openai',
  llm_model: 'gpt-4',
  llm_timeout_seconds: 3,
  enable_resubmission_learning: true,
  max_resubmission_attempts: 3,
  safety_level_thresholds: {
    require_confirmation: 4,
    auto_deny: 5,
  },
};

// デフォルト基本安全ルール (限定的な安全コマンドのみ)
export const DEFAULT_BASIC_SAFETY_RULES: BasicSafetyRule[] = [
  // 表示・確認系（引数制限あり）
  {
    pattern: '^ls(\\s+-[lart]*)?(\\s+[^|>;&]+)?$',
    reasoning: 'Directory listing',
    safety_level: 1,
  },
  { pattern: '^pwd$', reasoning: 'Current directory', safety_level: 1 },
  { pattern: '^whoami$', reasoning: 'Current user', safety_level: 1 },
  { pattern: '^date(\\s+-[^|>;&]+)?$', reasoning: 'Date display', safety_level: 1 },

  // ファイル内容表示（リダイレクト無し）
  { pattern: '^cat\\s+[^|>;&]+$', reasoning: 'File content display', safety_level: 1 },
  {
    pattern: '^head(\\s+-n\\s*\\d+)?\\s+[^|>;&]+$',
    reasoning: 'File head display',
    safety_level: 1,
  },
  {
    pattern: '^tail(\\s+-n\\s*\\d+)?\\s+[^|>;&]+$',
    reasoning: 'File tail display',
    safety_level: 1,
  },

  // 検索・フィルタ（基本形のみ）
  { pattern: '^grep\\s+[^|>;&]+\\s+[^|>;&]+$', reasoning: 'Simple grep search', safety_level: 1 },
  { pattern: '^wc(\\s+-[lwc])?\\s+[^|>;&]+$', reasoning: 'Word count', safety_level: 1 },
  { pattern: '^which\\s+[a-zA-Z0-9_-]+$', reasoning: 'Command location', safety_level: 1 },
];

// ========================================
// Function Call Handler Types and Interfaces
// ========================================

// Function Call Handler Arguments Types
export const EvaluateCommandSecurityArgsSchema = z.object({
  command: z.string(),
  working_directory: z.string(),
  additional_context: z.string().optional()
});

export type EvaluateCommandSecurityArgs = z.infer<typeof EvaluateCommandSecurityArgsSchema>;

export const ReevaluateWithUserIntentArgsSchema = z.object({
  command: z.string(),
  working_directory: z.string(),
  additional_context: z.string().optional(),
  user_intent: z.string(),
  previous_evaluation: SimplifiedLLMEvaluationResultSchema
});

export type ReevaluateWithUserIntentArgs = z.infer<typeof ReevaluateWithUserIntentArgsSchema>;

export const ReevaluateWithAdditionalContextArgsSchema = z.object({
  command: z.string(),
  working_directory: z.string(),
  additional_context: z.string().optional(),
  command_history: z.array(z.string()).optional(),
  execution_results: z.array(z.string()).optional()
});

export type ReevaluateWithAdditionalContextArgs = z.infer<typeof ReevaluateWithAdditionalContextArgsSchema>;

// Function Call Handler Context
export interface FunctionCallContext {
  command: string;
  comment?: string;
  historyManager?: unknown; // CommandHistoryManager - to be typed properly later
  securityManager?: unknown; // SecurityManager - to be typed properly later
  userIntentMemory?: Map<string, unknown>;
}

// Function Call Handler Results
export interface FunctionCallResult {
  success: boolean;
  result?: SimplifiedLLMEvaluationResult;
  error?: string;
  context?: FunctionCallContext;
}

// Function Call Handler Signature
export type FunctionCallHandler<TArgs = unknown> = (
  args: TArgs,
  context: FunctionCallContext
) => Promise<FunctionCallResult>;

// Function Call Handler Registry
export interface FunctionCallHandlerRegistry {
  'evaluate_command_security': FunctionCallHandler<EvaluateCommandSecurityArgs>;
  'reevaluate_with_user_intent': FunctionCallHandler<ReevaluateWithUserIntentArgs>;
  'reevaluate_with_additional_context': FunctionCallHandler<ReevaluateWithAdditionalContextArgs>;
}
