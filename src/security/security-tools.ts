/**
 * Security Evaluation Tools for Function Calling
 * New individual tool approach - each evaluation result has its own tool
 */

// Individual Security Evaluation Tools

export const allowTool = {
  type: 'function' as const,
  function: {
    name: 'allow',
    description: 'Allow command execution - the command is safe to execute',
    parameters: {
      type: "object" as const,
      properties: {
        reasoning: {
          type: "string" as const,
          description: 'Detailed reasoning for why the command is safe'
        }
      },
      required: ['reasoning'],
      additionalProperties: false
    }
  }
};

export const denyTool = {
  type: 'function' as const,
  function: {
    name: 'deny',
    description: 'Deny command execution - the command is too dangerous to execute',
    parameters: {
      type: "object" as const,
      properties: {
        reasoning: {
          type: "string" as const,
          description: 'Detailed reasoning for why the command is dangerous'
        },
        suggested_alternatives: {
          type: "array" as const,
          items: { type: "string" as const },
          description: 'List of safer alternative commands'
        }
      },
      required: ['reasoning', 'suggested_alternatives'],
      additionalProperties: false
    }
  }
};

export const userConfirmTool = {
  type: 'function' as const,
  function: {
    name: 'user_confirm',
    description: 'Request user confirmation - the command requires explicit user permission before execution',
    parameters: {
      type: "object" as const,
      properties: {
        reasoning: {
          type: "string" as const,
          description: 'Detailed reasoning for why user confirmation is needed'
        },
        confirmation_question: {
          type: "string" as const,
          description: 'Specific question to ask the user for confirmation (include alternatives if applicable)'
        }
      },
      required: ['reasoning', 'confirmation_question'],
      additionalProperties: false
    }
  }
};

export const addMoreHistoryTool = {
  type: 'function' as const,
  function: {
    name: 'add_more_history',
    description: 'Request additional command history - need more system context to make a decision',
    parameters: {
      type: "object" as const,
      properties: {
        reasoning: {
          type: "string" as const,
          description: 'Detailed reasoning for why more history is needed'
        },
        command_history_depth: {
          type: "number" as const,
          minimum: 1,
          maximum: 50,
          description: 'How many more commands back in history to examine'
        },
        execution_results_count: {
          type: "number" as const,
          minimum: 0,
          maximum: 10,
          description: 'How many recent commands need their execution details'
        },
        user_intent_search_keywords: {
          type: "array" as const,
          items: { type: "string" as const },
          description: 'Keywords to search for in previous user intent responses'
        }
      },
      required: ['reasoning', 'command_history_depth'],
      additionalProperties: false
    }
  }
};

export const aiAssistantConfirmTool = {
  type: 'function' as const,
  function: {
    name: 'ai_assistant_confirm',
    description: 'Request information from AI assistant - need additional context that assistant can provide',
    parameters: {
      type: "object" as const,
      properties: {
        reasoning: {
          type: "string" as const,
          description: 'Detailed reasoning for why assistant information is needed'
        },
        assistant_request_message: {
          type: "string" as const,
          description: 'Specific message/question to show to the AI assistant'
        }
      },
      required: ['reasoning', 'assistant_request_message'],
      additionalProperties: false
    }
  }
};

// Combined tools array for easy import
export const newSecurityEvaluationTools = [
  allowTool,
  denyTool,
  userConfirmTool,
  addMoreHistoryTool,
  aiAssistantConfirmTool
];
