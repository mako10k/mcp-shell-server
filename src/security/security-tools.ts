/**
 * Security Evaluation Tools for Function Calling
 * OpenAI互換APIのtools機能を使用した構造化アプローチ
 */

// Common schema definitions for reuse
const additionalContextSchema = {
  type: 'object',
  properties: {
    command_history_depth: {
      type: 'number',
      minimum: 0,
      description: 'How many more commands back in history to examine (0 = no more needed)'
    },
    execution_results_count: {
      type: 'number',
      minimum: 0,
      description: 'How many recent commands need their execution details'
    },
    user_intent_search_keywords: {
      type: 'array',
      items: { type: 'string' },
      nullable: true,
      description: 'Keywords to search for in previous user intent responses'
    },
    user_intent_question: {
      type: 'string',
      nullable: true,
      description: 'Specific question to ask user for intent clarification'
    }
  },
  required: ['command_history_depth', 'execution_results_count', 'user_intent_search_keywords', 'user_intent_question'],
  additionalProperties: false
};

const suggestedAlternativesSchema = {
  type: 'array',
  items: { type: 'string' },
  description: 'List of suggested alternative commands if applicable'
};

export const securityEvaluationTool = {
  type: 'function' as const,
  function: {
    name: 'evaluate_command_security',
    description: 'Evaluates the security implications of a shell command',
    parameters: {
      type: 'object',
      properties: {
        evaluation_result: {
          type: 'string',
          enum: ['ALLOW', 'CONDITIONAL_ALLOW', 'CONDITIONAL_DENY', 'DENY', 'NEED_MORE_INFO'],
          description: 'Final evaluation result for the command'
        },
        reasoning: {
          type: 'string',
          description: 'Detailed reasoning for the evaluation decision'
        },
        requires_additional_context: additionalContextSchema,
        suggested_alternatives: suggestedAlternativesSchema
      },
      required: ['evaluation_result', 'reasoning', 'requires_additional_context', 'suggested_alternatives'],
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
      type: 'object',
      properties: {
        evaluation_result: {
          type: 'string',
          enum: ['ALLOW', 'CONDITIONAL_DENY', 'DENY'],
          description: 'The final security evaluation result after considering user intent'
        },
        reasoning: {
          type: 'string',
          description: 'Updated reasoning considering the user intent'
        },
        confidence_level: {
          type: 'number',
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
      type: 'object',
      properties: {
        evaluation_result: {
          type: 'string',
          enum: ['ALLOW', 'CONDITIONAL_DENY', 'DENY', 'NEED_MORE_INFO'],
          description: 'The security evaluation result with additional context'
        },
        reasoning: {
          type: 'string',
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
