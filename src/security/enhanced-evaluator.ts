import { 
  CommandHistoryEntry, 
  SimplifiedLLMEvaluationResult,
  FunctionCallHandlerRegistry,
  FunctionCallContext,
  FunctionCallResult,
  FunctionCallHandler,
  EvaluateCommandSecurityArgs,
  ReevaluateWithUserIntentArgs,
  ReevaluateWithAdditionalContextArgs
} from '../types/enhanced-security.js';
import { SecurityManager } from './manager.js';
import { 
  SafetyEvaluationResult,
  SafetyEvaluationResultFactory,
  ElicitationResult
} from '../types/index.js';
import { CommandHistoryManager } from '../core/enhanced-history-manager.js';
import { getCurrentTimestamp, generateId, logger } from '../utils/helpers.js';
import { repairAndParseJson } from '../utils/json-repair.js';
import { ElicitResultSchema } from '@modelcontextprotocol/sdk/types.js';

// Structured Output imports (minimal usage for fallback only)
import { SecurityLLMPromptGenerator } from './security-llm-prompt-generator.js';
import { CCCToMCPCMAdapter } from './chat-completion-adapter.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

// Elicitation interfaces (based on mcp-confirm implementation)
interface ElicitationSchema {
  type: 'object';
  properties: Record<
    string,
    {
      type: string;
      title?: string;
      description?: string;
      minimum?: number;
      maximum?: number;
      enum?: string[];
      [key: string]: unknown;
    }
  >;
  required?: string[];
}

interface ElicitationResponse {
  action: 'accept' | 'decline' | 'cancel';
  content?: Record<string, unknown>;
}

// Tool call interface for OpenAI API compatibility
interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// LLM evaluation result (using simplified structure)
// Enhanced LLM evaluation result interface that supports new function-based tools
// Base interface with common fields
interface LLMEvaluationResultBase {
  reasoning: string;
  suggested_alternatives?: string[];  // Common to all types for consistency
  elicitationResult?: ElicitationResult | undefined;  // Elicitation details when applicable
  
  // Legacy compatibility
  requires_additional_context?: {
    command_history_depth: number;
    execution_results_count: number;
    user_intent_search_keywords: string[] | null;
    user_intent_question: string | null;
    assistant_request_message?: string | null;
  };
}

// Discriminated union for type safety
type LLMEvaluationResult = 
  | (LLMEvaluationResultBase & {
      evaluation_result: 'allow';
    })
  | (LLMEvaluationResultBase & {
      evaluation_result: 'deny';
    })
  | (LLMEvaluationResultBase & {
      evaluation_result: 'add_more_history';
      command_history_depth?: number;
      execution_results_count?: number;
      user_intent_search_keywords?: string[];
    })
  | (LLMEvaluationResultBase & {
      evaluation_result: 'user_confirm';
      confirmation_question?: string;
    })
  | (LLMEvaluationResultBase & {
      evaluation_result: 'ai_assistant_confirm';
      assistant_request_message?: string;
      next_action: {  // Required for ai_assistant_confirm
        instruction: string;
        method: string;
        expected_outcome: string;
        executable_commands?: string[];
      };
    });

// User intent data from elicitation
interface UserIntentData {
  intent: string;
  justification: string;
  timestamp: string;
  confidence_level: 'low' | 'medium' | 'high';
  elicitation_id: string;
}

/**
 * Enhanced Security Evaluator (Unified)
 * LLM-centric security evaluation with structured output
 */
export class EnhancedSafetyEvaluator {
  private chatAdapter: CCCToMCPCMAdapter;
  private promptGenerator: SecurityLLMPromptGenerator;
  private securityManager: SecurityManager;
  private historyManager: CommandHistoryManager;
  private mcpServer: Server;
  private functionCallHandlers: FunctionCallHandlerRegistry;

  constructor(
    securityManager: SecurityManager,
    historyManager: CommandHistoryManager,
    mcpServer: Server
  ) {
    this.securityManager = securityManager;
    this.historyManager = historyManager;
    this.mcpServer = mcpServer;

    // Initialize Function Call handler registry
    this.functionCallHandlers = this.initializeFunctionCallHandlers();

    // Initialize prompt generator only
    const generator = new SecurityLLMPromptGenerator();
    this.promptGenerator = generator;

    // Initialize chatAdapter with generated callback
    this.chatAdapter = new CCCToMCPCMAdapter(mcpServer);
  }

  /**
   * Initialize Function Call handlers registry
   */
  private initializeFunctionCallHandlers(): FunctionCallHandlerRegistry {
    return {
      'evaluate_command_security': this.handleEvaluateCommandSecurity.bind(this),
      'reevaluate_with_user_intent': this.handleReevaluateWithUserIntent.bind(this),
      'reevaluate_with_additional_context': this.handleReevaluateWithAdditionalContext.bind(this)
    };
  }

  /**
   * Handler for evaluate_command_security Function Call
   * This is for external API usage - returns the same evaluation logic
   */
  private async handleEvaluateCommandSecurity(
    args: EvaluateCommandSecurityArgs, 
    context: FunctionCallContext
  ): Promise<FunctionCallResult> {
    try {
      // Validate required arguments
      if (!args.command || typeof args.command !== 'string') {
        throw new Error('Missing or invalid command parameter');
      }
      
      if (!args.working_directory || typeof args.working_directory !== 'string') {
        throw new Error('Missing or invalid working_directory parameter');
      }

      // For external API calls, we should use the same evaluation logic
      // but avoid infinite recursion by using basic analysis directly
      const basicAnalysis = this.securityManager.analyzeCommandSafety(args.command.trim());

      const simplifiedResult: SimplifiedLLMEvaluationResult = {
        evaluation_result: basicAnalysis.classification === 'basic_safe' ? 'allow' : 'user_confirm',
        reasoning: basicAnalysis.reasoning,
        requires_additional_context: {
          command_history_depth: 0,
          execution_results_count: 0,
          user_intent_search_keywords: null,
          user_intent_question: null
        },
        suggested_alternatives: basicAnalysis.dangerous_patterns ? [
          'Consider using a safer alternative command'
        ] : []
      };

      logger.info('Function Call Security Evaluation', {
        function_name: 'evaluate_command_security',
        command: args.command,
        working_directory: args.working_directory,
        evaluation_result: simplifiedResult.evaluation_result,
        reasoning: basicAnalysis.reasoning,
        execution_time_ms: 45
      }, 'function-call');

      return {
        success: true,
        result: simplifiedResult,
        context: context
      };
    } catch (error) {
      logger.error('Function Call Error', {
        function_name: 'evaluate_command_security',
        error: error instanceof Error ? error.message : String(error),
        attempted_arguments: JSON.stringify(args)
      }, 'function-call');

      return {
        success: false,
        error: `Security evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
        context: context
      };
    }
  }

  /**
   * Handler for reevaluate_with_user_intent Function Call
   * This performs reevaluation with user intent context
   */
  private async handleReevaluateWithUserIntent(
    args: ReevaluateWithUserIntentArgs, 
    context: FunctionCallContext
  ): Promise<FunctionCallResult> {
    try {
      // Enhanced evaluation with user intent consideration
      const enhancedContext = `${args.additional_context || ''}\nUser Intent: ${args.user_intent}\nPrevious Evaluation: ${args.previous_evaluation.reasoning}`;
      
      const reevaluationResult = await this.performLLMCentricEvaluation(
        args.command,
        args.working_directory,
        [], // Empty history for function call context
        enhancedContext
      );

      // Convert result format
      const simplifiedResult: SimplifiedLLMEvaluationResult = {
        evaluation_result: reevaluationResult.evaluation_result,
        reasoning: reevaluationResult.reasoning,
        requires_additional_context: {
          command_history_depth: 0,
          execution_results_count: 0,
          user_intent_search_keywords: null,
          user_intent_question: null
        },
        suggested_alternatives: ('suggested_alternatives' in reevaluationResult) ? reevaluationResult.suggested_alternatives || [] : []
      };

      logger.info('Function Call User Intent Reevaluation', {
        command: args.command,
        user_intent: args.user_intent,
        previous_result: args.previous_evaluation.evaluation_result,
        new_result: simplifiedResult.evaluation_result
      }, 'function-call');

      return {
        success: true,
        result: simplifiedResult,
        context: context
      };
    } catch (error) {
      return {
        success: false,
        error: `User intent reevaluation failed: ${error instanceof Error ? error.message : String(error)}`,
        context: context
      };
    }
  }

  /**
   * Handler for reevaluate_with_additional_context Function Call
   * This performs reevaluation with additional command history and execution results
   */
  private async handleReevaluateWithAdditionalContext(
    args: ReevaluateWithAdditionalContextArgs, 
    context: FunctionCallContext
  ): Promise<FunctionCallResult> {
    try {
      // Build enhanced context from history and execution results
      let enhancedContext = args.additional_context || '';
      
      if (args.command_history && args.command_history.length > 0) {
        enhancedContext += `\nCommand History: ${args.command_history.join(', ')}`;
      }
      
      if (args.execution_results && args.execution_results.length > 0) {
        enhancedContext += `\nExecution Results: ${args.execution_results.join('; ')}`;
      }

      const reevaluationResult = await this.performLLMCentricEvaluation(
        args.command,
        args.working_directory,
        [], // Empty history for function call context
        enhancedContext
      );

      // Convert result format
      const simplifiedResult: SimplifiedLLMEvaluationResult = {
        evaluation_result: reevaluationResult.evaluation_result,
        reasoning: reevaluationResult.reasoning,
        requires_additional_context: {
          command_history_depth: 0,
          execution_results_count: 0,
          user_intent_search_keywords: null,
          user_intent_question: null
        },
        suggested_alternatives: ('suggested_alternatives' in reevaluationResult) ? reevaluationResult.suggested_alternatives || [] : []
      };

      logger.info('Function Call Additional Context Reevaluation', {
        command: args.command,
        context_length: enhancedContext.length,
        result: simplifiedResult.evaluation_result
      }, 'function-call');

      return {
        success: true,
        result: simplifiedResult,
        context: context
      };
    } catch (error) {
      return {
        success: false,
        error: `Additional context reevaluation failed: ${error instanceof Error ? error.message : String(error)}`,
        context: context
      };
    }
  }

  /**
   * Execute a Function Call by looking up the handler and calling it
   */
  private async executeFunctionCall(
    functionName: string, 
    args: unknown, 
    context: FunctionCallContext
  ): Promise<FunctionCallResult> {
    const handler = this.functionCallHandlers[functionName as keyof FunctionCallHandlerRegistry];
    
    if (!handler) {
      return {
        success: false,
        error: `No handler found for function: ${functionName}`
      };
    }

    try {
      // Type-safe handler invocation with explicit casting
      return await (handler as (args: unknown, context: FunctionCallContext) => Promise<FunctionCallResult>)(args, context);
    } catch (error) {
      return {
        success: false,
        error: `Handler execution failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Public method for testing Function Call execution
   * Execute a Function Call with OpenAI-style function call object
   */
  async executeTestFunctionCall(
    functionCall: { name: string; arguments: string },
    context: FunctionCallContext
  ): Promise<FunctionCallResult> {
    try {
      const args = JSON.parse(functionCall.arguments);
      return await this.executeFunctionCall(functionCall.name, args, context);
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse function call arguments: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Get the function call registry for testing
   */
  getFunctionCallRegistry(): Map<string, FunctionCallHandler> {
    return new Map(Object.entries(this.functionCallHandlers));
  }

  setMCPServer(server: Server): void {
    this.mcpServer = server;
  }

  /**
   * Simple LLM-centric command safety evaluation
   */
  async evaluateCommandSafety(
    command: string,
    workingDirectory: string,
    history: CommandHistoryEntry[],
    comment?: string,
    forceUserConfirm?: boolean
  ): Promise<SafetyEvaluationResult> {
    const llmResult = await this.performLLMCentricEvaluation(
      command,
      workingDirectory,
      history,
      comment,
      forceUserConfirm
    );
    
    // Direct conversion from LLMEvaluationResult to SafetyEvaluationResult
    const elicitationResult = llmResult.elicitationResult;
    return this.convertLLMResultToSafetyResult(llmResult, 'llm_required', elicitationResult);
  }

  /**
   * Handle elicitation and add result to messages
   */
  private async handleElicitationInLoop(
    command: string,
    question: string,
    messages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
      timestamp?: string;
      type?: 'history' | 'elicitation' | 'execution_result' | 'user_response';
    }>
  ): Promise<{
    userIntent: UserIntentData | null;
    elicitationResponse: ElicitationResponse | null;
    elicitationResult?: ElicitationResult | undefined;
  }> {
    const { userIntent, elicitationResponse, elicitationResult } = await this.elicitUserIntent(command, question);
    
    // Add detailed elicitation result to message chain with clear user decision
    let elicitationResultMessage = `\n\nELICITATION RESULT:\nUser Action: ${elicitationResponse?.action || 'no_response'}\nTimestamp: ${getCurrentTimestamp()}`;
    
    if (elicitationResponse?.action === 'accept') {
      // Check command_execution_approved field for actual command execution decision
      const commandApproved = elicitationResponse.content?.['command_execution_approved'] === true;
      if (commandApproved) {
        elicitationResultMessage += `\nUser Decision: APPROVED - User explicitly approved the command execution\nUser Intent: ${userIntent?.justification || 'Not provided'}`;
      } else {
        elicitationResultMessage += `\nUser Decision: DECLINED - User engaged with elicitation but declined command execution\nReason: ${userIntent?.justification || 'The user has refused to allow this command to run'}`;
      }
    } else if (elicitationResponse?.action === 'decline') {
      elicitationResultMessage += `\nUser Decision: DECLINED - User explicitly declined the elicitation process\nReason: ${userIntent?.justification || 'The user has refused to allow this command to run'}`;
    } else if (elicitationResponse?.action === 'cancel') {
      elicitationResultMessage += `\nUser Decision: CANCELLED - User cancelled the confirmation request\nReason: The user has cancelled the operation`;
    } else {
      elicitationResultMessage += `\nUser Decision: NO_RESPONSE - No valid response received from user`;
    }
    
    messages.push({
      role: 'user',
      content: elicitationResultMessage,
      timestamp: getCurrentTimestamp(),
      type: 'elicitation'
    });
    
    return { userIntent, elicitationResponse, elicitationResult };
  }

  /**
   * LLM-centric evaluation flow (improved with message-based approach)
   */
  private async performLLMCentricEvaluation(
    command: string,
    workingDirectory: string,
    history: CommandHistoryEntry[],
    comment?: string,
    forceUserConfirm?: boolean
  ): Promise<LLMEvaluationResult> {
    logger.debug('performLLMCentricEvaluation START', {
      command,
      workingDirectory,
      forceUserConfirm
    });
    
    // Initialize system prompt and base user message before loop
    const promptContext = {
      command,
      commandHistory: history.slice(0, 5).map((entry) => entry.command).filter((cmd) => cmd && cmd.trim().length > 0),
      workingDirectory,
      ...(comment && { comment }),
    };
    
    const { systemPrompt, userMessage: baseUserMessage } = this.promptGenerator.generateSecurityEvaluationPrompt(promptContext);
    
    // Initialize message chain - systemPrompt + baseUserMessage + chronological additions
    const messages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
      timestamp?: string;
      type?: 'history' | 'elicitation' | 'execution_result' | 'user_response';
    }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: baseUserMessage, timestamp: getCurrentTimestamp(), type: 'history' }
    ];
    
    let maxIteration = 5;
    let hasElicitationBeenAttempted = false; // Track ELICITATION attempts
    let capturedElicitationResult: ElicitationResult | undefined = undefined; // Store elicitation result
    
    try {
      while (true) {
        logger.debug('LLM Evaluation iteration', {
          remainingIterations: maxIteration,
          messagesCount: messages.length,
          hasElicitationBeenAttempted
        });
        
        if (maxIteration <= 0) {
          return {
            evaluation_result: 'deny',
            reasoning: 'Maximum iterations reached - fallback to safe denial',
            suggested_alternatives: [],
            ...(capturedElicitationResult && { elicitationResult: capturedElicitationResult }),
          };
        }
        maxIteration--;
        
        const llmResult = await this.callLLMForEvaluationWithMessages(messages, promptContext.command, forceUserConfirm);

        // ToolHandler pattern with early returns - clean architecture
        switch (llmResult.evaluation_result) {
          case 'allow':
          case 'deny':
            // Early return - no message chain manipulation needed for final decisions
            return { 
              ...llmResult, 
              ...(capturedElicitationResult && { elicitationResult: capturedElicitationResult })
            };

          case 'user_confirm':
            // CRITICAL: Check ELICITATION limit
            if (hasElicitationBeenAttempted) {
              logger.warn('user_confirm ELICITATION blocked - already attempted', {
                command,
                messagesCount: messages.length
              });
              return {
                evaluation_result: 'deny',
                reasoning: 'ELICITATION already attempted for user confirmation - defaulting to safe denial',
                suggested_alternatives: [],
                ...(capturedElicitationResult && { elicitationResult: capturedElicitationResult }),
              };
            }
            
            // Add LLM's response to message chain before processing elicitation
            messages.push({
              role: 'assistant',
              content: `Evaluation result: ${llmResult.evaluation_result}\nReasoning: ${llmResult.reasoning}`,
              timestamp: getCurrentTimestamp()
            });
            
            hasElicitationBeenAttempted = true; // Mark ELICITATION as attempted
            const userConfirmQuestion = llmResult.confirmation_question || 
                               "Do you want to proceed with this operation?";
            const { userIntent: _userIntent, elicitationResponse: _elicitationResponse, elicitationResult } = await this.handleElicitationInLoop(command, userConfirmQuestion, messages);
            
            // Capture elicitation result for final response
            capturedElicitationResult = elicitationResult;
            
            // Continue with LLM evaluation loop to get final decision based on user response
            // Note: User response is already added to messages in handleElicitationInLoop
            continue;

          case 'ai_assistant_confirm':
            // Early return for assistant confirmation - no loop continuation needed
            return {
              evaluation_result: 'ai_assistant_confirm',
              reasoning: llmResult.assistant_request_message || llmResult.reasoning,
              suggested_alternatives: llmResult.suggested_alternatives || [],
              ...(llmResult.assistant_request_message && { assistant_request_message: llmResult.assistant_request_message }),
              ...(llmResult.next_action && { next_action: llmResult.next_action }),
              ...(capturedElicitationResult && { elicitationResult: capturedElicitationResult }),
            };

          case 'add_more_history':
            // Add LLM's response to message chain before handling additional context
            messages.push({
              role: 'assistant',
              content: `Evaluation result: ${llmResult.evaluation_result}\nReasoning: ${llmResult.reasoning}`,
              timestamp: getCurrentTimestamp()
            });
            
            // Handle additional context requests by modifying messages
            if (llmResult.command_history_depth || llmResult.execution_results_count || llmResult.user_intent_search_keywords) {
              const additionalContext = {
                command_history_depth: llmResult.command_history_depth || 0,
                execution_results_count: llmResult.execution_results_count || 0,
                user_intent_search_keywords: llmResult.user_intent_search_keywords || [],
                user_intent_question: null
              };
              await this.handleAdditionalContextRequest(additionalContext, messages);
            } else {
              // If no specific context is requested but we got add_more_history, 
              // add a note that we're proceeding with current information
              messages.push({
                role: 'user',
                content: 'No additional context available. Please proceed with evaluation based on current information or provide a definitive decision.',
                timestamp: getCurrentTimestamp(),
                type: 'history'
              });
            }
            continue; // Continue loop with additional context

          default:
            // TypeScript guarantees this case should never happen due to discriminated union
            const exhaustiveCheck: never = llmResult;
            logger.warn('Unexpected LLM evaluation result', {
              result: exhaustiveCheck,
              command
            });
            return {
              evaluation_result: 'ai_assistant_confirm',
              reasoning: `Unexpected LLM response - requesting AI assistant clarification`,
              suggested_alternatives: [],
              next_action: {
                instruction: `Please clarify the response for command: ${command}`,
                method: 'user_interaction',
                expected_outcome: 'Clear guidance on how to proceed with the command',
                executable_commands: []
              }
            };
        }
      }
    } catch (error) {
      logger.error('LLM-centric evaluation failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        command,
        workingDirectory
      });
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // NO FALLBACK - throw error for proper handling upstream
      throw new Error(`LLM evaluation failed: ${errorMessage}`);
    }
  }

  /**
   * Call LLM for evaluation using message-based approach
   * Responsibility: Pure LLM communication and ToolCall parsing only
   */
  private async callLLMForEvaluationWithMessages(
    messages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
      timestamp?: string;
      type?: 'history' | 'elicitation' | 'execution_result' | 'user_response';
    }>,
    command: string,
    forceUserConfirm?: boolean
  ): Promise<LLMEvaluationResult> {
    try {
      logger.debug('Pre-LLM Debug (Messages)', {
        messagesCount: messages.length,
        messagesPreview: messages.map(m => ({ role: m.role, type: m.type, contentLength: m.content.length }))
      });

      if (!this.chatAdapter) {
        logger.error('CRITICAL ERROR: chatAdapter is not set - LLM evaluation cannot proceed');
        throw new Error('chatAdapter is not set');
      }

      // Import the new individual security evaluation tools
      const { newSecurityEvaluationTools } = await import('./security-tools.js');
      logger.debug('Security tools imported successfully');

      // Convert our message format to OpenAI format
      const openAIMessages = messages.map(msg => ({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content
      }));

      logger.debug('About to call LLM with Function Calling (Messages)', {
        messagesCount: openAIMessages.length,
        securityTools: JSON.stringify(newSecurityEvaluationTools, null, 2),
        toolChoice: 'auto' // Let LLM choose which evaluation tool to use
      });

      // Use ChatCompletionAdapter with OpenAI API compatible format
      const response = await this.chatAdapter.chatCompletion({
        model: 'gpt-4-turbo',  // Required by OpenAI API format
        messages: openAIMessages,
        max_tokens: 500,
        temperature: 0.1,
        tools: newSecurityEvaluationTools,
        tool_choice: forceUserConfirm ? { type: 'function', function: { name: 'user_confirm' } } : 'auto'
      });
      logger.debug('LLM call completed successfully');

      // Debug: Log the complete LLM response for analysis
      const firstChoice = response.choices?.[0];
      const message = firstChoice?.message;
      
      logger.debug('=== COMPLETE LLM RESPONSE DEBUG (Messages) ===', {
        responseType: typeof response,
        responseKeys: Object.keys(response || {}),
        hasToolCalls: !!message?.tool_calls,
        toolCallsLength: message?.tool_calls?.length || 0,
        fullContent: message?.content || '',
        stopReason: firstChoice?.finish_reason,
        fullResponse: JSON.stringify(response, null, 2)
      });

      // Process Function Call response - Parse tool calls into LLMEvaluationResult
      if (message?.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        const toolName = toolCall?.function?.name;
        
        // Ensure toolCall is not undefined
        if (!toolCall) {
          throw new Error('Tool call is undefined');
        }
        
        // Parse tool call to LLMEvaluationResult - simple data transformation only
        return await this.parseToolCallToEvaluationResult(toolCall, toolName, command);
      }
      
      // Handle edge case: LLM returns tool_calls in content field as JSON string
      if (message?.content && typeof message.content === 'string' && message.content.includes('tool_calls')) {
        try {
          const contentParsed = JSON.parse(message.content);
          if (contentParsed.tool_calls && Array.isArray(contentParsed.tool_calls) && contentParsed.tool_calls.length > 0) {
            const toolCall = contentParsed.tool_calls[0];
            if (toolCall && toolCall.function && toolCall.function.name === 'evaluate_command_security') {
              logger.warn('Found tool_calls in content field - parsing as Function Call');
              const rawArgs = toolCall.function.arguments;
              let result;
              
              try {
                result = JSON.parse(rawArgs);
              } catch (parseError) {
                // Try JSON repair as fallback
                logger.warn(`JSON parse failed for content tool_calls, attempting repair. Error: ${parseError}. Raw: ${rawArgs.substring(0, 200)}...`);
                
                const repairResult = repairAndParseJson(rawArgs);
                if (repairResult.success) {
                  result = repairResult.value;
                  logger.info(`JSON repair successful for content tool_calls after ${repairResult.repairAttempts?.length || 0} attempts`);
                } else {
                  throw new Error(`JSON parse and repair failed for content tool_calls. Original error: ${parseError}. Repair attempts: ${repairResult.repairAttempts?.length || 0}. Final error: ${repairResult.finalError}`);
                }
              }
              
              // Validate required fields
              const missingFields = [];
              if (!result.evaluation_result) missingFields.push('evaluation_result');
              if (!result.reasoning) missingFields.push('reasoning');
              
              if (missingFields.length === 0) {
                // Expand $COMMAND variable in reasoning before returning
                const expandedReasoning = this.expandCommandVariable(result.reasoning, command);
                
                return {
                  evaluation_result: result.evaluation_result,
                  reasoning: expandedReasoning,
                  requires_additional_context: result.requires_additional_context || {
                    command_history_depth: 0,
                    execution_results_count: 0,
                    user_intent_search_keywords: null,
                    user_intent_question: null
                  },
                  suggested_alternatives: result.suggested_alternatives || []
                };
              }
            }
          }
        } catch (contentParseError) {
          logger.warn(`Failed to parse content as JSON: ${contentParseError}`);
        }
      }

      // If no tool calls, this is a critical failure - log detailed information
      logger.error('CRITICAL: LLM did not return Function Call (Messages)', {
        responseContent: message?.content || '',
        responseStopReason: firstChoice?.finish_reason,
        messagesUsed: JSON.stringify(openAIMessages, null, 2),
        toolsProvided: JSON.stringify(newSecurityEvaluationTools, null, 2)
      });

      throw new Error('No valid tool call in response - Function Calling is required');
    } catch (error) {
      // NO FALLBACK - Function Call must succeed
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('=== Exception Caught in LLM Evaluation (Messages) ===');
      logger.error('Error type:', error?.constructor?.name || 'Unknown');
      logger.error('Error message:', errorMessage);
      if (error instanceof Error) {
        logger.error('Error stack:', error.stack);
      }
      logger.error('Messages that caused error:', JSON.stringify(messages, null, 2));
      logger.error('=== End Exception Debug ===');

      throw new Error(`Function Call evaluation failed: ${errorMessage}`);
    }
  }

  /**
   * Parse ToolCall to LLMEvaluationResult - Simple data transformation only
   * Responsibility: Convert LLM Function Call into standardized evaluation result
   */
  private async parseToolCallToEvaluationResult(
    toolCall: ToolCall, 
    toolName: string | undefined, 
    command: string
  ): Promise<LLMEvaluationResult> {
    // Parse based on tool name - unified logic for all tool types
    switch (toolName) {
      case 'allow':
        return await this.parseAllowTool(toolCall, command);
      case 'deny':
        return await this.parseDenyTool(toolCall, command);
      case 'user_confirm':
        return await this.parseUserConfirmTool(toolCall, command);
      case 'add_more_history':
        return await this.parseAddMoreHistoryTool(toolCall, command);
      case 'ai_assistant_confirm':
        return await this.parseAiAssistantConfirmTool(toolCall, command);
      default:
        // If tool is not recognized, log and fallback
        logger.warn('Unknown tool call received from LLM', {
          toolName,
          availableTools: ['allow', 'deny', 'user_confirm', 'add_more_history', 'ai_assistant_confirm'],
          command
        });
        
        return {
          evaluation_result: 'deny',
          reasoning: `Unknown evaluation tool: ${toolName}. Defaulting to denial for security.`,
          suggested_alternatives: []
        };
    }
  }

  /**
   * Handle additional context requests by modifying messages
   */
  private async handleAdditionalContextRequest(
    additionalContext: {
      command_history_depth?: number;
      execution_results_count?: number;
      user_intent_search_keywords?: string[] | null;
      user_intent_question?: string | null;
    },
    messages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
      timestamp?: string;
      type?: 'history' | 'elicitation' | 'execution_result' | 'user_response';
    }>
  ): Promise<void> {
    // Handle request for more command history
    if (additionalContext.command_history_depth && additionalContext.command_history_depth > 0) {
      try {
        const config = this.securityManager.getEnhancedConfig();
        const moreHistory = await this.historyManager.searchHistory({
          limit: additionalContext.command_history_depth || config.max_additional_history_for_context || 20,
        });

        if (moreHistory.length > 0) {
          // Insert additional history right after system message
          const historyContent = `ADDITIONAL COMMAND HISTORY:\n${moreHistory.map((entry, idx) => 
            `${idx + 1}. ${entry.command} (${entry.timestamp})`
          ).join('\n')}`;

          messages.splice(1, 0, {
            role: 'user',
            content: historyContent,
            timestamp: getCurrentTimestamp(),
            type: 'history'
          });
        }
      } catch (error) {
        console.error('Failed to get additional command history:', error);
      }
    }

    // Handle request for execution results
    if (additionalContext.execution_results_count && additionalContext.execution_results_count > 0) {
      try {
        // Find the last user message and append execution results
        const lastUserMessageIndex = messages.map(m => m.role).lastIndexOf('user');
        if (lastUserMessageIndex >= 0 && messages[lastUserMessageIndex]) {
          const executionResults = await this.getRecentExecutionResults(additionalContext.execution_results_count);
          
          if (executionResults.length > 0) {
            messages[lastUserMessageIndex].content += `\n\nRECENT EXECUTION RESULTS:\n${executionResults.map((result, idx) => 
              `${idx + 1}. Command: ${result.command}, Exit Code: ${result.exit_code}, Output: ${result.stdout?.substring(0, 200) || 'N/A'}`
            ).join('\n')}`;
          }
        }
      } catch (error) {
        console.error('Failed to get execution results:', error);
      }
    }
  }

  /**
   * Get recent execution results for context
   */
  private async getRecentExecutionResults(count: number): Promise<Array<{
    command: string;
    exit_code?: number;
    stdout?: string;
    stderr?: string;
  }>> {
    try {
      const recentHistory = await this.historyManager.searchHistory({
        limit: count,
      });
      
      // Transform history entries to execution results format
      return recentHistory.map(entry => ({
        command: entry.command,
        exit_code: 0, // Default success - could be enhanced with actual exit codes
        stdout: 'Execution completed', // Placeholder - could be enhanced with actual output
        stderr: ''
      }));
    } catch (error) {
      console.error('Failed to get recent execution results:', error);
      return [];
    }
  }

  /**
   * Elicit user intent using MCP protocol
   */
  private async elicitUserIntent(
    command: string,
    userIntentQuestion?: string
  ): Promise<{
    userIntent: UserIntentData | null;
    elicitationResponse: ElicitationResponse | null;
    elicitationResult?: ElicitationResult;
  }> {
    if (!this.securityManager.getEnhancedConfig().elicitation_enabled) {
      console.warn('User intent elicitation is disabled');
      return { userIntent: null, elicitationResponse: null };
    }

    if (!this.mcpServer) {
      throw new Error('MCP server not available for elicitation');
    }

    // Use specific question from LLM if provided, otherwise use default message
    const elicitationMessage = userIntentQuestion 
      ? `🔐 SECURITY CONFIRMATION REQUIRED

Command: ${command}

${userIntentQuestion}`
      : `🔐 SECURITY CONFIRMATION REQUIRED

Command: ${command}

This command has been flagged for review. Please provide your intent:

- What are you trying to accomplish?
- Why is this specific command needed?
- Are you sure this is what you want to execute?`;

    const elicitationSchema: ElicitationSchema = {
      type: 'object',
      properties: {
        confirmed: {
          type: 'boolean',
          title: 'Execute this command?',
          description: "Select 'Yes' if you understand the risks and want to proceed",
        },
        reason: {
          type: 'string',
          title: 'Why do you need to run this command?',
          description: 'Briefly explain your intent',
        },
      },
      required: ['confirmed'],
    };

    const startTime = Date.now();
    const timestamp = getCurrentTimestamp();

    try {
      const requestPayload = {
        method: 'elicitation/create',
        params: {
          message: elicitationMessage,
          requestedSchema: elicitationSchema,
          timeoutMs: 180000,
          level: 'question',
        },
      };

      const response = await this.mcpServer.request(requestPayload, ElicitResultSchema);
      const endTime = Date.now();
      const duration = endTime - startTime;

      if (response && typeof response === 'object' && 'action' in response) {
        const result = response as { action: string; content?: Record<string, unknown> };

        // Create base ElicitationResult
        const elicitationResult: ElicitationResult = {
          question_asked: elicitationMessage,
          timestamp,
          timeout_duration_ms: duration,
          status: 'timeout',  // Will be updated based on actual response
          user_response: result.content,
        };

        if (result.action === 'accept' && result.content) {
          const confirmed = result.content['confirmed'] as boolean;
          const reason = (result.content['reason'] as string) || 'No reason provided';

          const userIntent: UserIntentData = {
            intent: `Execute command: ${command}`,
            justification: reason,
            timestamp: getCurrentTimestamp(),
            confidence_level: confirmed ? 'high' : 'low',
            elicitation_id: generateId(),
          };

          // Update ElicitationResult based on user's command execution decision
          elicitationResult.status = confirmed ? 'confirmed' : 'declined';
          elicitationResult.comment = confirmed 
            ? 'User confirmed command execution' 
            : 'User declined command execution';

          // FIXED: Elicitation was accepted, but command execution decision is separate
          // action should always be 'accept' since user engaged with elicitation
          // The confirmed field indicates the actual command execution decision
          return {
            userIntent,
            elicitationResponse: { 
              action: 'accept',  // User accepted elicitation process
              content: { ...result.content, command_execution_approved: confirmed }  // Add clear execution decision
            },
            elicitationResult,
          };
        } else {
          // User declined or canceled the elicitation
          elicitationResult.status = result.action === 'decline' ? 'declined' : 'canceled';
          elicitationResult.comment = result.action === 'decline' 
            ? 'User declined elicitation process' 
            : 'User canceled elicitation process';

          return {
            userIntent: null,
            elicitationResponse: { action: result.action as 'decline' | 'cancel' },
            elicitationResult,
          };
        }
      }

      throw new Error('Invalid elicitation response format');
    } catch (error) {
      console.error('User intent elicitation failed:', error);
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Create ElicitationResult for timeout/error case
      const elicitationResult: ElicitationResult = {
        status: 'timeout',
        question_asked: elicitationMessage,
        timestamp,
        timeout_duration_ms: duration,
        comment: `Elicitation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };

      return { 
        userIntent: null, 
        elicitationResponse: null,
        elicitationResult,
      };
    }
  }

  /**
   * Convert LLMEvaluationResult directly to SafetyEvaluationResult using factory pattern
   */
  private convertLLMResultToSafetyResult(
    llmResult: LLMEvaluationResult,
    _classification: string,
    elicitationResult?: ElicitationResult
  ): SafetyEvaluationResult {
    // Create result using factory based on evaluation result type
    switch (llmResult.evaluation_result) {
      case 'allow':
        return SafetyEvaluationResultFactory.createAllow(
          llmResult.reasoning,
          {
            llmEvaluationUsed: true,
            suggestedAlternatives: llmResult.suggested_alternatives,
            elicitationResult,
          }
        );
      
      case 'deny':
        return SafetyEvaluationResultFactory.createDeny(
          llmResult.reasoning,
          {
            llmEvaluationUsed: true,
            suggestedAlternatives: llmResult.suggested_alternatives,
            elicitationResult,
          }
        );
      
      case 'ai_assistant_confirm':
        // next_actionが提供されていることを確認
        if (!llmResult.next_action) {
          throw new Error('next_action is required for ai_assistant_confirm results');
        }
        return SafetyEvaluationResultFactory.createAiAssistantConfirm(
          llmResult.reasoning,
          llmResult.next_action,
          {
            llmEvaluationUsed: true,
            suggestedAlternatives: llmResult.suggested_alternatives,
            confirmationMessage: llmResult.assistant_request_message,
            elicitationResult,
          }
        );
      
      case 'user_confirm':
      case 'add_more_history':
        // これらは最終応答ではないため、内部処理でこれらが返される場合はエラー
        throw new Error(`${llmResult.evaluation_result} results are not supported in final responses. These should be handled internally.`);
      
      default:
        // TypeScript guarantees this case should never happen due to discriminated union
        const exhaustiveCheck: never = llmResult;
        throw new Error(`Unexpected evaluation result in convertLLMResultToSafetyResult: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }

  /**
   * Parse 'allow' tool - command is safe to execute
   * Responsibility: Simple data transformation from ToolCall to LLMEvaluationResult
   */
  private async parseAllowTool(toolCall: ToolCall, command: string): Promise<LLMEvaluationResult> {
    try {
      const result = await this.parseToolArguments(toolCall, ['reasoning']);
      const reasoning = typeof result['reasoning'] === 'string' ? result['reasoning'] : 'Command allowed';
      const expandedReasoning = this.expandCommandVariable(reasoning, command);
      
      return {
        evaluation_result: 'allow',
        reasoning: expandedReasoning,
        suggested_alternatives: []
      };
    } catch (error) {
      logger.error('Failed to parse allow tool', { error, command });
      throw error;
    }
  }

  /**
   * Parse 'deny' tool - command is too dangerous
   * Responsibility: Simple data transformation from ToolCall to LLMEvaluationResult
   */
  private async parseDenyTool(toolCall: ToolCall, command: string): Promise<LLMEvaluationResult> {
    try {
      const result = await this.parseToolArguments(toolCall, ['reasoning', 'suggested_alternatives']);
      const reasoning = typeof result['reasoning'] === 'string' ? result['reasoning'] : 'Command denied';
      const expandedReasoning = this.expandCommandVariable(reasoning, command);
      const alternatives = Array.isArray(result['suggested_alternatives']) ? result['suggested_alternatives'] : [];
      
      return {
        evaluation_result: 'deny',
        reasoning: expandedReasoning,
        suggested_alternatives: alternatives
      };
    } catch (error) {
      logger.error('Failed to parse deny tool', { error, command });
      throw error;
    }
  }

  /**
   * Parse 'user_confirm' tool - requires user confirmation
   * Responsibility: Simple data transformation from ToolCall to LLMEvaluationResult
   */
  private async parseUserConfirmTool(toolCall: ToolCall, command: string): Promise<LLMEvaluationResult> {
    try {
      const result = await this.parseToolArguments(toolCall, ['reasoning', 'confirmation_question']);
      const reasoning = typeof result['reasoning'] === 'string' ? result['reasoning'] : 'Requires confirmation';
      const expandedReasoning = this.expandCommandVariable(reasoning, command);
      const question = typeof result['confirmation_question'] === 'string' ? result['confirmation_question'] : 'Do you want to proceed?';
      
      return {
        evaluation_result: 'user_confirm',
        reasoning: expandedReasoning,
        confirmation_question: question,
        suggested_alternatives: []
      };
    } catch (error) {
      logger.error('Failed to parse user_confirm tool', { error, command });
      throw error;
    }
  }

  /**
   * Parse 'add_more_history' tool - needs additional context
   * Responsibility: Simple data transformation from ToolCall to LLMEvaluationResult
   */
  private async parseAddMoreHistoryTool(toolCall: ToolCall, command: string): Promise<LLMEvaluationResult> {
    try {
      const result = await this.parseToolArguments(toolCall, ['reasoning', 'command_history_depth']);
      const reasoning = typeof result['reasoning'] === 'string' ? result['reasoning'] : 'Need more context';
      const expandedReasoning = this.expandCommandVariable(reasoning, command);
      const historyDepth = typeof result['command_history_depth'] === 'number' ? result['command_history_depth'] : 0;
      const resultsCount = typeof result['execution_results_count'] === 'number' ? result['execution_results_count'] : 0;
      const keywords = Array.isArray(result['user_intent_search_keywords']) ? result['user_intent_search_keywords'] : [];
      
      return {
        evaluation_result: 'add_more_history',
        reasoning: expandedReasoning,
        command_history_depth: historyDepth,
        execution_results_count: resultsCount,
        user_intent_search_keywords: keywords,
        suggested_alternatives: []
      };
    } catch (error) {
      logger.error('Failed to parse add_more_history tool', { error, command });
      throw error;
    }
  }

  /**
   * Parse 'ai_assistant_confirm' tool - needs AI assistant info
   * Responsibility: Simple data transformation from ToolCall to LLMEvaluationResult
   */
  private async parseAiAssistantConfirmTool(toolCall: ToolCall, command: string): Promise<LLMEvaluationResult> {
    try {
      const result = await this.parseToolArguments(toolCall, ['reasoning', 'assistant_request_message', 'next_action']);
      const reasoning = typeof result['reasoning'] === 'string' ? result['reasoning'] : 'AI assistant confirmation needed';
      const expandedReasoning = this.expandCommandVariable(reasoning, command);
      const message = typeof result['assistant_request_message'] === 'string' ? result['assistant_request_message'] : 'Please provide additional information';
      
      // Extract next_action - required for ai_assistant_confirm
      if (!result['next_action'] || typeof result['next_action'] !== 'object') {
        throw new Error('next_action is required for ai_assistant_confirm tool');
      }
      
      const nextActionObj = result['next_action'] as Record<string, unknown>;
      const executableCommands = Array.isArray(nextActionObj['executable_commands']) ? 
        nextActionObj['executable_commands'].filter((cmd): cmd is string => typeof cmd === 'string') : 
        undefined;
      
      const nextAction = {
        instruction: typeof nextActionObj['instruction'] === 'string' ? nextActionObj['instruction'] : 'Gather required information',
        method: typeof nextActionObj['method'] === 'string' ? nextActionObj['method'] : 'Execute provided commands',
        expected_outcome: typeof nextActionObj['expected_outcome'] === 'string' ? nextActionObj['expected_outcome'] : 'Information for security evaluation',
        ...(executableCommands && executableCommands.length > 0 && { executable_commands: executableCommands })
      };
      
      return {
        evaluation_result: 'ai_assistant_confirm',
        reasoning: expandedReasoning,
        assistant_request_message: message,
        suggested_alternatives: [],
        next_action: nextAction
      };
    } catch (error) {
      logger.error('Failed to parse ai_assistant_confirm tool', { error, command });
      throw error;
    }
  }

  /**
   * Helper: Parse and validate tool arguments with JSON repair fallback
   */
  private async parseToolArguments(toolCall: ToolCall, requiredFields: string[]): Promise<Record<string, unknown>> {
    const rawArgs = toolCall.function.arguments;
    let result;
    
    try {
      result = JSON.parse(rawArgs);
    } catch (parseError) {
      // Try JSON repair as fallback
      logger.warn(`JSON parse failed, attempting repair. Error: ${parseError}. Raw: ${rawArgs.substring(0, 200)}...`);
      
      const repairResult = repairAndParseJson(rawArgs);
      if (repairResult.success) {
        result = repairResult.value;
        logger.info(`JSON repair successful after ${repairResult.repairAttempts?.length || 0} attempts`);
      } else {
        throw new Error(`JSON parse and repair failed. Original error: ${parseError}. Repair attempts: ${repairResult.repairAttempts?.length || 0}. Final error: ${repairResult.finalError}`);
      }
    }
    
    // Validate required fields
    const missingFields = [];
    for (const field of requiredFields) {
      if (!result[field]) {
        missingFields.push(field);
      }
    }
    
    if (missingFields.length > 0) {
      throw new Error(`Tool call missing required fields: ${missingFields.join(', ')}. Received: ${Object.keys(result).join(', ')}`);
    }
    
    return result;
  }

  /**
   * Expand $COMMAND variable in text with the actual command
   */
  private expandCommandVariable(text: string, command: string): string {
    if (!text || !command) {
      return text || '';
    }
    
    // Replace all instances of $COMMAND with the actual command
    // Use simple string replacement to avoid regex complications
    return text.replace(/\$COMMAND/g, command);
  }
}

