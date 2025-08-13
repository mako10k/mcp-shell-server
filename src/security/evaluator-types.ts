import { z } from 'zod';

// Zod schemas for enhanced evaluator type definitions

export const MessageContentSchema = z.object({
  type: z.literal('text'),
  text: z.string()
});

export const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.string()
  })
});

export const CreateMessageRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'tool']),
    content: MessageContentSchema,
    tool_call_id: z.string().optional()
  })),
  maxTokens: z.number().optional(),
  temperature: z.number().optional(),
  systemPrompt: z.string().optional(),
  includeContext: z.enum(['none', 'thisServer', 'allServers']).optional(),
  stopSequences: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  modelPreferences: z.record(z.unknown()).optional(),
  tools: z.array(z.object({
    type: z.literal('function'),
    function: z.object({
      name: z.string(),
      description: z.string(),
      parameters: z.record(z.unknown())
    })
  })).optional(),
  tool_choice: z.union([
    z.literal('auto'),
    z.literal('none'),
    z.object({ type: z.literal('function'), function: z.object({ name: z.string() }) }),
    z.object({ type: z.literal('tool'), name: z.string() })
  ]).optional()
});

export const CreateMessageResponseSchema = z.object({
  content: MessageContentSchema,
  model: z.string().optional(),
  stopReason: z.string().optional(),
  tool_calls: z.array(z.object({
    id: z.string(),
    type: z.literal('function'),
    function: z.object({
      name: z.string(),
      arguments: z.string()
    })
  })).optional()
});

export const ElicitationPropertySchema = z.object({
  type: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  enum: z.array(z.string()).optional()
}).catchall(z.unknown());

export const ElicitationSchemaSchema = z.object({
  type: z.literal('object'),
  properties: z.record(ElicitationPropertySchema),
  required: z.array(z.string()).optional()
});

export const ElicitationResponseSchema = z.object({
  action: z.enum(['accept', 'decline', 'cancel']),
  content: z.record(z.unknown()).optional()
});

export const RequiresAdditionalContextSchema = z.object({
  command_history_depth: z.number(),
  execution_results_count: z.number(),
  user_intent_search_keywords: z.array(z.string()).nullable(),
  user_intent_question: z.string().nullable(),
  assistant_request_message: z.string().nullable().optional()
});

export const LLMEvaluationResultSchema = z.object({
  evaluation_result: z.enum(['allow', 'deny', 'add_more_history', 'user_confirm', 'ai_assistant_confirm']),
  reasoning: z.string(),
  command_history_depth: z.number().optional(),
  execution_results_count: z.number().optional(),
  user_intent_search_keywords: z.array(z.string()).optional(),
  confirmation_question: z.string().optional(),
  assistant_request_message: z.string().optional(),
  suggested_alternatives: z.array(z.string()).optional(),
  requires_additional_context: RequiresAdditionalContextSchema.optional()
});

export const UserIntentDataSchema = z.object({
  intent: z.string(),
  justification: z.string(),
  timestamp: z.string(),
  confidence_level: z.enum(['low', 'medium', 'high']),
  elicitation_id: z.string()
});

export const NextActionSchema = z.object({
  instruction: z.string(),
  method: z.string(),
  expected_outcome: z.string()
});

export const SafetyEvaluationSchema = z.object({
  evaluation_result: z.enum(['allow', 'deny', 'add_more_history', 'user_confirm', 'ai_assistant_confirm']),
  basic_classification: z.string(),
  reasoning: z.string(),
  requires_confirmation: z.boolean(),
  suggested_alternatives: z.array(z.string()),
  llm_evaluation_used: z.boolean(),
  user_confirmation_required: z.boolean().optional(),
  user_response: z.record(z.unknown()).optional(),
  confirmation_message: z.string().optional(),
  elicitation_response: ElicitationResponseSchema.nullable().optional(),
  next_action: NextActionSchema.optional()
});

export const MCPServerRequestSchema = z.object({
  method: z.string(),
  params: z.record(z.unknown()).optional()
});

// Type definitions from Zod schemas
export type MessageContent = z.infer<typeof MessageContentSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type CreateMessageRequest = z.infer<typeof CreateMessageRequestSchema>;
export type CreateMessageResponse = z.infer<typeof CreateMessageResponseSchema>;
export type ElicitationProperty = z.infer<typeof ElicitationPropertySchema>;
export type ElicitationSchema = z.infer<typeof ElicitationSchemaSchema>;
export type ElicitationResponse = z.infer<typeof ElicitationResponseSchema>;
export type RequiresAdditionalContext = z.infer<typeof RequiresAdditionalContextSchema>;
export type LLMEvaluationResult = z.infer<typeof LLMEvaluationResultSchema>;
export type UserIntentData = z.infer<typeof UserIntentDataSchema>;
export type NextAction = z.infer<typeof NextActionSchema>;
export type SafetyEvaluation = z.infer<typeof SafetyEvaluationSchema>;
export type MCPServerRequest = z.infer<typeof MCPServerRequestSchema>;

// Interface definitions that require function signatures
export interface MCPServerInterface {
  request(
    request: MCPServerRequest,
    schema?: unknown
  ): Promise<unknown>;
}
