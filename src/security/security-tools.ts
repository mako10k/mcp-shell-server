/**
 * Security Evaluation Tools for Function Calling
 * Structured approach using OpenAI-compatible API tools functionality
 */

const suggestedAlternativesSchema = {
  type: "array" as const,
  items: { type: "string" as const },
  description: 'List of suggested alternative commands if applicable'
};

// Enhanced schema for new evaluation system
const enhancedAdditionalContextSchema = {
  type: "object" as const,
  properties: {
    command_history_depth: {
      type: "number" as const,
      minimum: 0,
      description: 'How many more commands back in history to examine (0 = no more needed)'
    },
    execution_results_count: {
      type: "number" as const,
      minimum: 0,
      description: 'How many recent commands need their execution details'
    },
    user_intent_search_keywords: {
      type: "array" as const,
      items: { type: "string" as const },
      nullable: true,
      description: 'Keywords to search for in previous user intent responses'
    },
    user_intent_question: {
      type: "string" as const,
      nullable: true,
      description: 'Specific question to ask user for intent clarification'
    },
    assistant_request_message: {
      type: "string" as const,
      nullable: true,
      description: 'Message to show to AI assistant for additional information or re-execution'
    }
  },
  required: ['command_history_depth', 'execution_results_count', 'user_intent_search_keywords', 'user_intent_question', 'assistant_request_message'],
  additionalProperties: false
};

// New enhanced security evaluation tool
export const enhancedSecurityEvaluationTool = {
  type: 'function' as const,
  function: {
    name: 'evaluate_command_security',
    description: 'Evaluates the security implications of a shell command with clear response categories',
    parameters: {
      type: "object" as const,
      properties: {
        evaluation_result: {
          type: "string" as const,
          enum: ['ALLOW', 'DENY', 'NEED_MORE_HISTORY', 'NEED_USER_CONFIRM', 'NEED_ASSISTANT_CONFIRM'],
          description: 'Clear evaluation result: ALLOW (safe to execute), DENY (too dangerous), NEED_MORE_HISTORY (requires system history data), NEED_USER_CONFIRM (requires user permission), NEED_ASSISTANT_CONFIRM (requires assistant information)'
        },
        reasoning: {
          type: "string" as const,
          description: 'Detailed reasoning for the evaluation decision'
        },
        requires_additional_context: enhancedAdditionalContextSchema,
        suggested_alternatives: suggestedAlternativesSchema
      },
      required: ['evaluation_result', 'reasoning'],
      additionalProperties: false
    }
  }
};

// Common schema definitions for reuse (OpenAI API compatible) - backward compatibility
const additionalContextSchema = {
  type: "object" as const,
  properties: {
    command_history_depth: {
      type: "number" as const,
      minimum: 0,
      description: 'How many more commands back in history to examine (0 = no more needed)'
    },
    execution_results_count: {
      type: "number" as const,
      minimum: 0,
      description: 'How many recent commands need their execution details'
    },
    user_intent_search_keywords: {
      type: "array" as const,
      items: { type: "string" as const },
      nullable: true,
      description: 'Keywords to search for in previous user intent responses'
    },
    user_intent_question: {
      type: "string" as const,
      nullable: true,
      description: 'Specific question to ask user for intent clarification'
    }
  },
  required: ['command_history_depth', 'execution_results_count', 'user_intent_search_keywords', 'user_intent_question'],
  additionalProperties: false
};

export const securityEvaluationTool = {
  type: 'function' as const,
  function: {
    name: 'evaluate_command_security',
    description: 'Evaluates the security implications of a shell command (LEGACY - use enhancedSecurityEvaluationTool)',
    parameters: {
      type: "object" as const,
      properties: {
        evaluation_result: {
          type: "string" as const,
          enum: ['ALLOW', 'DENY', 'NEED_MORE_HISTORY', 'NEED_USER_CONFIRM', 'NEED_ASSISTANT_CONFIRM'],
          description: 'Final evaluation result for the command'
        },
        reasoning: {
          type: "string" as const,
          description: 'Detailed reasoning for the evaluation decision'
        },
        requires_additional_context: additionalContextSchema,
        suggested_alternatives: suggestedAlternativesSchema
      },
      required: ['evaluation_result', 'reasoning'],
      additionalProperties: false
    }
  }
};

export const userIntentReevaluationTool = {
  type: 'function' as const,
  function: {
    name: 'reevaluate_with_user_intent',
    description: 'Re-evaluate command security with user intent information',
    parameters: {
      type: "object" as const,
      properties: {
        evaluation_result: {
          type: "string" as const,
          enum: ['ALLOW', 'DENY'],
          description: 'The final security evaluation result after considering user intent'
        },
        reasoning: {
          type: "string" as const,
          description: 'Updated reasoning considering the user intent'
        },
        confidence_level: {
          type: "number" as const,
          minimum: 0.0,
          maximum: 1.0,
          description: 'Confidence level in the evaluation (0.0 to 1.0)'
        },
        suggested_alternatives: suggestedAlternativesSchema
      },
      required: ['evaluation_result', 'reasoning', 'confidence_level', 'suggested_alternatives'],
      additionalProperties: false
    }
  }
};

export const additionalContextReevaluationTool = {
  type: 'function' as const,
  function: {
    name: 'reevaluate_with_additional_context',
    description: 'Re-evaluate command security with additional context information',
    parameters: {
      type: "object" as const,
      properties: {
        evaluation_result: {
          type: "string" as const,
          enum: ['ALLOW', 'DENY', 'NEED_MORE_HISTORY', 'NEED_USER_CONFIRM', 'NEED_ASSISTANT_CONFIRM'],
          description: 'The security evaluation result with additional context'
        },
        reasoning: {
          type: "string" as const,
          description: 'Updated reasoning considering the additional context'
        },
        requires_additional_context: additionalContextSchema,
        suggested_alternatives: suggestedAlternativesSchema
      },
      required: ['evaluation_result', 'reasoning', 'requires_additional_context', 'suggested_alternatives'],
      additionalProperties: false
    }
  }
};
