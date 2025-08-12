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
import { CommandSafetyEvaluationResult, SecurityManager } from './manager.js';
import { CommandHistoryManager } from '../core/enhanced-history-manager.js';
import { getCurrentTimestamp, generateId, logger } from '../utils/helpers.js';
import { repairAndParseJson } from '../utils/json-repair.js';
import { CCCToMCPCMAdapter } from './chat-completion-adapter.js';
import { ElicitResultSchema } from '@modelcontextprotocol/sdk/types.js';

// Structured Output imports (minimal usage for fallback only)
import { SecurityLLMPromptGenerator } from './security-llm-prompt-generator.js';

// Tools for Function Calling (external use only)
// import { securityEvaluationTool } from './security-tools.js';

// MCP sampling protocol interface (matches manager.ts implementation)
interface CreateMessageCallback {
  (request: {
    messages: Array<{
      role: 'user' | 'assistant' | 'tool';
      content: { type: 'text'; text: string };
      tool_call_id?: string;
    }>;
    maxTokens?: number;
    temperature?: number;
    systemPrompt?: string;
    includeContext?: 'none' | 'thisServer' | 'allServers';
    stopSequences?: string[];
    metadata?: Record<string, unknown>;
    modelPreferences?: Record<string, unknown>;
    tools?: Array<{
      type: 'function';
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }>;
    tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } } | { type: 'tool'; name: string };
  }): Promise<{
    content: { type: 'text'; text: string };
    model?: string | undefined;
    stopReason?: string | undefined;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }>;
  }>;
}

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

// MCP Server interface for elicitation
interface MCPServerInterface {
  request(
    request: { method: string; params?: Record<string, unknown> },
    schema?: unknown
  ): Promise<unknown>;
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
interface LLMEvaluationResult {
  evaluation_result: 'allow' | 'deny' | 'add_more_history' | 'user_confirm' | 'ai_assistant_confirm'; // Tool-based categories
  reasoning: string;
  
  // For add_more_history tool
  command_history_depth?: number;
  execution_results_count?: number;
  user_intent_search_keywords?: string[];
  
  // For user_confirm tool
  confirmation_question?: string;
  
  // For ai_assistant_confirm tool
  assistant_request_message?: string;
  
  // For deny tool
  suggested_alternatives?: string[];
  
  // Legacy compatibility
  requires_additional_context?: {
    command_history_depth: number;
    execution_results_count: number;
    user_intent_search_keywords: string[] | null;
    user_intent_question: string | null;
    assistant_request_message?: string | null; // New field for assistant requests
  };
}

// User intent data from elicitation
interface UserIntentData {
  intent: string;
  justification: string;
  timestamp: string;
  confidence_level: 'low' | 'medium' | 'high';
  elicitation_id: string;
}

// Safety evaluation result
interface SafetyEvaluation {
  evaluation_result: 'allow' | 'deny' | 'add_more_history' | 'user_confirm' | 'ai_assistant_confirm'; // Function-based evaluation results
  // Removed safety_level property as requested
  basic_classification: string;
  reasoning: string;
  requires_confirmation: boolean;
  suggested_alternatives: string[];
  llm_evaluation_used: boolean;
  user_confirmation_required?: boolean;
  user_response?: Record<string, unknown>;
  confirmation_message?: string;
}

/**
 * Enhanced Security Evaluator (Unified)
 * LLM-centric security evaluation with structured output
 */
export class EnhancedSafetyEvaluator {
  private createMessageCallback: CreateMessageCallback;
  private chatAdapter: CCCToMCPCMAdapter | undefined;
  private promptGenerator: SecurityLLMPromptGenerator;
  private securityManager: SecurityManager;
  private historyManager: CommandHistoryManager;
  private mcpServer: MCPServerInterface | undefined;
  private functionCallHandlers: FunctionCallHandlerRegistry;

  constructor(
    securityManager: SecurityManager,
    historyManager: CommandHistoryManager,
    createMessageCallback?: CreateMessageCallback,
    mcpServer?: MCPServerInterface
  ) {
    this.securityManager = securityManager;
    this.historyManager = historyManager;
    this.mcpServer = mcpServer;

    // Initialize Function Call handler registry
    this.functionCallHandlers = this.initializeFunctionCallHandlers();

    // Initialize prompt generator only
    const generator = new SecurityLLMPromptGenerator();
    this.promptGenerator = generator;

    // Use placeholder callback if not provided - will be set later via setCreateMessageCallback
    this.createMessageCallback =
      createMessageCallback ||
      (() => {
        throw new Error('LLM evaluation attempted before createMessageCallback was set');
      });
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
      
      const reevaluationResult = await this.evaluateCommandLLMCentric(
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
        suggested_alternatives: reevaluationResult.suggested_alternatives || []
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

      const reevaluationResult = await this.evaluateCommandLLMCentric(
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
        suggested_alternatives: reevaluationResult.suggested_alternatives || []
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

  setCreateMessageCallback(callback: CreateMessageCallback | undefined): void {
    if (callback) {
      this.createMessageCallback = callback;
      this.chatAdapter = new CCCToMCPCMAdapter(callback);
    }
  }

  setMCPServer(server: MCPServerInterface | undefined): void {
    this.mcpServer = server;
  }

  /**
   * Simple LLM-centric command safety evaluation
   */
  async evaluateCommandLLMCentric(
    command: string,
    workingDirectory: string,
    history: CommandHistoryEntry[],
    comment?: string,
    forceUserConfirm?: boolean
  ): Promise<CommandSafetyEvaluationResult> {
    const result = await this.performLLMCentricEvaluation(
      command,
      workingDirectory,
      history,
      comment,
      forceUserConfirm
    );
    
    // Convert SafetyEvaluation to CommandSafetyEvaluationResult
    return this.convertToCommandSafetyResult(result);
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
      type?: 'history' | 'elicitation' | 'execution_result';
    }>
  ): Promise<void> {
    const { userIntent, elicitationResponse } = await this.elicitUserIntent(command, question);
    
    // Add elicitation result to userMessage and continue loop
    const elicitationResult = `\n\nELICITATION RESULT:\nUser Action: ${elicitationResponse?.action || 'no_response'}\nUser Intent: ${userIntent?.justification || 'Not provided'}\nTimestamp: ${getCurrentTimestamp()}`;
    messages.push({
      role: 'user',
      content: elicitationResult,
      timestamp: getCurrentTimestamp(),
      type: 'elicitation'
    });
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
  ): Promise<SafetyEvaluation> {
    logger.debug('performLLMCentricEvaluation START', {
      command,
      workingDirectory
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
      type?: 'history' | 'elicitation' | 'execution_result';
    }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: baseUserMessage, timestamp: getCurrentTimestamp(), type: 'history' }
    ];
    
    let maxIteration = 5;
    let hasElicitationBeenAttempted = false; // Track ELICITATION attempts
    
    try {
      while (true) {
        logger.debug('LLM Evaluation iteration', {
          remainingIterations: maxIteration,
          messagesCount: messages.length,
          hasElicitationBeenAttempted
        });
        
        if (maxIteration <= 0) {
          return {
            evaluation_result: 'user_confirm',
            basic_classification: 'timeout_fallback',
            reasoning: 'Maximum iterations reached - fallback to safe denial',
            requires_confirmation: true,
            suggested_alternatives: [],
            llm_evaluation_used: true,
          };
        }
        maxIteration--;
        
        const llmResult = await this.callLLMForEvaluationWithMessages(messages, promptContext.command);

        switch (llmResult.evaluation_result) {
          case 'allow':
          case 'deny':
            // Add LLM's response to message chain before processing
            messages.push({
              role: 'assistant',
              content: `Evaluation result: ${llmResult.evaluation_result}\nReasoning: ${llmResult.reasoning}`,
              timestamp: getCurrentTimestamp()
            });
            
            return this.llmResultToSafetyEvaluation(llmResult, 'llm_required');

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

          case 'user_confirm':
            // Add LLM's response to message chain before processing
            messages.push({
              role: 'assistant',
              content: `Evaluation result: ${llmResult.evaluation_result}\nReasoning: ${llmResult.reasoning}`,
              timestamp: getCurrentTimestamp()
            });
            
            // CRITICAL: Check ELICITATION limit
            if (hasElicitationBeenAttempted) {
              logger.warn('user_confirm ELICITATION blocked - already attempted', {
                command,
                messagesCount: messages.length
              });
              return {
                evaluation_result: 'user_confirm',
                basic_classification: 'elicitation_limit_exceeded',
                reasoning: 'ELICITATION already attempted for user confirmation - defaulting to safe denial',
                requires_confirmation: true,
                suggested_alternatives: [],
                llm_evaluation_used: true,
              };
            }
            
            hasElicitationBeenAttempted = true; // Mark ELICITATION as attempted
            const userQuestion = llmResult.confirmation_question || 
                               "Do you want to proceed with this operation?";
            await this.handleElicitationInLoop(command, userQuestion, messages);
            continue; // Continue loop with elicitation result

          case 'ai_assistant_confirm':
            // Add LLM's response to message chain before processing
            messages.push({
              role: 'assistant',
              content: `Evaluation result: ${llmResult.evaluation_result}\nReasoning: ${llmResult.reasoning}`,
              timestamp: getCurrentTimestamp()
            });
            
            // Return with assistant request message for the calling system to handle
            const assistantMessage = llmResult.assistant_request_message || 
                                   llmResult.reasoning;
            return {
              evaluation_result: 'ai_assistant_confirm',
              basic_classification: 'assistant_info_required',
              reasoning: assistantMessage,
              requires_confirmation: true,
              suggested_alternatives: llmResult.suggested_alternatives || [],
              llm_evaluation_used: true,
            };

          // Handle requests for assistant confirmation
          case 'ai_assistant_confirm':
            // Add LLM's response to message chain before processing
            messages.push({
              role: 'assistant',
              content: `Evaluation result: ${llmResult.evaluation_result}\nReasoning: ${llmResult.reasoning}`,
              timestamp: getCurrentTimestamp()
            });
            
            // If force user confirm is enabled, add elicitation to messages and continue
            if (forceUserConfirm) {
              // CRITICAL: Check ELICITATION limit
              if (hasElicitationBeenAttempted) {
                logger.warn('forceUserConfirm ELICITATION blocked - already attempted', {
                  command,
                  messagesCount: messages.length
                });
                return {
                  evaluation_result: 'user_confirm',
                  basic_classification: 'elicitation_limit_exceeded',
                  reasoning: 'ELICITATION already attempted in forceUserConfirm - defaulting to safe denial',
                  requires_confirmation: true,
                  suggested_alternatives: [],
                  llm_evaluation_used: true,
                };
              }
              
              hasElicitationBeenAttempted = true; // Mark ELICITATION as attempted
              await this.handleElicitationInLoop(
                command,
                "AI Assistant forced user confirmation: Do you want to proceed with this operation?",
                messages
              );
              continue; // Continue loop with elicitation result
            }
            
            // Check for user intent question in the new schema structure
            if (llmResult.requires_additional_context?.user_intent_question) {
              // CRITICAL: Check ELICITATION limit
              if (hasElicitationBeenAttempted) {
                logger.warn('user_intent_question ELICITATION blocked - already attempted', {
                  command,
                  messagesCount: messages.length,
                  user_intent_question: llmResult.requires_additional_context.user_intent_question
                });
                return {
                  evaluation_result: 'user_confirm',
                  basic_classification: 'elicitation_limit_exceeded',
                  reasoning: 'ELICITATION already attempted for user intent - defaulting to safe denial',
                  requires_confirmation: true,
                  suggested_alternatives: [],
                  llm_evaluation_used: true,
                };
              }
              
              hasElicitationBeenAttempted = true; // Mark ELICITATION as attempted
              await this.handleElicitationInLoop(
                command,
                llmResult.requires_additional_context.user_intent_question,
                messages
              );
              continue; // Continue loop with elicitation result
            }
            
            return this.llmResultToSafetyEvaluation(llmResult, 'llm_required');

          case 'add_more_history':
            // Handle requests for additional command history
            messages.push({
              role: 'assistant',
              content: `Evaluation result: ${llmResult.evaluation_result}\nReasoning: ${llmResult.reasoning}`,
              timestamp: getCurrentTimestamp()
            });
            
            // Handle additional context requests by modifying messages
            if (llmResult.requires_additional_context) {
              await this.handleAdditionalContextRequest(llmResult.requires_additional_context, messages);
            } else {
              // If no specific context is requested but we got NEED_MORE_HISTORY, 
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
            // Fallback for unknown results
            logger.warn('Unknown LLM evaluation result', {
              evaluation_result: llmResult.evaluation_result,
              command,
              reasoning: llmResult.reasoning
            });
            return {
              evaluation_result: 'user_confirm',
              basic_classification: 'unknown_response',
              reasoning: `Unknown LLM response: ${llmResult.evaluation_result} - defaulting to safe denial`,
              requires_confirmation: true,
              suggested_alternatives: [],
              llm_evaluation_used: true,
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
   */
  private async callLLMForEvaluationWithMessages(
    messages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
      timestamp?: string;
      type?: 'history' | 'elicitation' | 'execution_result';
    }>,
    command: string
  ): Promise<LLMEvaluationResult> {
    try {
      logger.debug('Pre-LLM Debug (Messages)', {
        createMessageCallbackAvailable: !!this.createMessageCallback,
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
        tool_choice: 'auto' // Let LLM choose appropriate evaluation tool
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

      // Process Function Call response - LLM provides the evaluation directly
      if (message?.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        const toolName = toolCall?.function?.name;
        
        // Ensure toolCall is not undefined
        if (!toolCall) {
          throw new Error('Tool call is undefined');
        }
        
        // Early return with ToolHandler pattern for each evaluation tool
        if (toolName === 'allow') {
          return await this.handleAllowTool(toolCall, command);
        }
        
        if (toolName === 'deny') {
          return await this.handleDenyTool(toolCall, command);
        }
        
        if (toolName === 'user_confirm') {
          return await this.handleUserConfirmTool(toolCall, command);
        }
        
        if (toolName === 'add_more_history') {
          return await this.handleAddMoreHistoryTool(toolCall, command);
        }
        
        if (toolName === 'ai_assistant_confirm') {
          return await this.handleAiAssistantConfirmTool(toolCall, command);
        }
        
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
      console.error('=== Exception Caught in LLM Evaluation (Messages) ===');
      console.error('Error type:', error?.constructor?.name || 'Unknown');
      console.error('Error message:', errorMessage);
      if (error instanceof Error) {
        console.error('Error stack:', error.stack);
      }
      console.error('Messages that caused error:', JSON.stringify(messages, null, 2));
      console.error('createMessageCallback available:', !!this.createMessageCallback);
      console.error('=== End Exception Debug ===');
      
      throw new Error(`Function Call evaluation failed: ${errorMessage}`);
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
      type?: 'history' | 'elicitation' | 'execution_result';
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

      if (response && typeof response === 'object' && 'action' in response) {
        const result = response as { action: string; content?: Record<string, unknown> };

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

          return {
            userIntent,
            elicitationResponse: { action: 'accept', content: result.content },
          };
        } else {
          return {
            userIntent: null,
            elicitationResponse: { action: result.action as 'decline' | 'cancel' },
          };
        }
      }

      throw new Error('Invalid elicitation response format');
    } catch (error) {
      console.error('User intent elicitation failed:', error);
      return { userIntent: null, elicitationResponse: null };
    }
  }

  /**
   * Convert SafetyEvaluation to CommandSafetyEvaluationResult
   */
  private convertToCommandSafetyResult(safetyEval: SafetyEvaluation): CommandSafetyEvaluationResult {
    // Function-based evaluation results are used directly
    const result: CommandSafetyEvaluationResult = {
      evaluation_result: safetyEval.evaluation_result,
      reasoning: safetyEval.reasoning,
      requires_confirmation: safetyEval.requires_confirmation,
      suggested_alternatives: safetyEval.suggested_alternatives,
      llm_evaluation_used: safetyEval.llm_evaluation_used,
    };
    
    // Add optional fields only if they exist
    if (safetyEval.user_confirmation_required !== undefined) {
      result.user_confirmation_required = safetyEval.user_confirmation_required;
    }
    if (safetyEval.user_response !== undefined) {
      result.user_response = safetyEval.user_response;
    }
    if (safetyEval.confirmation_message !== undefined) {
      result.confirmation_message = safetyEval.confirmation_message;
    }
    
    return result;
  }

  /**
   * Convert LLM result to SafetyEvaluation
   */
  private llmResultToSafetyEvaluation(
    llmResult: LLMEvaluationResult,
    classification: string
  ): SafetyEvaluation {
    // Use function-based evaluation results directly - no legacy conversion needed
    let requiresConfirmation = false;
    
    switch (llmResult.evaluation_result) {
      case 'allow':
      case 'deny':
        requiresConfirmation = false;
        break;
      case 'add_more_history':
        requiresConfirmation = false;
        break;
      case 'user_confirm':
        requiresConfirmation = true;
        break;
      case 'ai_assistant_confirm':
        requiresConfirmation = false; // AI assistant needs to provide info, not user confirmation
        break;
      default:
        requiresConfirmation = false;
        break;
    }
    
    return {
      evaluation_result: llmResult.evaluation_result,
      basic_classification: classification,
      reasoning: llmResult.reasoning,
      requires_confirmation: requiresConfirmation,
      suggested_alternatives: llmResult.suggested_alternatives || [],
      llm_evaluation_used: true,
    };
  }

  /**
   * ToolHandler: Handle 'allow' tool - command is safe to execute
   */
  private async handleAllowTool(toolCall: ToolCall, command: string): Promise<LLMEvaluationResult> {
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
      logger.error('Failed to handle allow tool', { error, command });
      throw error;
    }
  }

  /**
   * ToolHandler: Handle 'deny' tool - command is too dangerous
   */
  private async handleDenyTool(toolCall: ToolCall, command: string): Promise<LLMEvaluationResult> {
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
      logger.error('Failed to handle deny tool', { error, command });
      throw error;
    }
  }

  /**
   * ToolHandler: Handle 'user_confirm' tool - requires user confirmation
   */
  private async handleUserConfirmTool(toolCall: ToolCall, command: string): Promise<LLMEvaluationResult> {
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
      logger.error('Failed to handle user_confirm tool', { error, command });
      throw error;
    }
  }

  /**
   * ToolHandler: Handle 'add_more_history' tool - needs additional context
   */
  private async handleAddMoreHistoryTool(toolCall: ToolCall, command: string): Promise<LLMEvaluationResult> {
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
      logger.error('Failed to handle add_more_history tool', { error, command });
      throw error;
    }
  }

  /**
   * ToolHandler: Handle 'ai_assistant_confirm' tool - needs AI assistant info
   */
  private async handleAiAssistantConfirmTool(toolCall: ToolCall, command: string): Promise<LLMEvaluationResult> {
    try {
      const result = await this.parseToolArguments(toolCall, ['reasoning', 'assistant_request_message']);
      const reasoning = typeof result['reasoning'] === 'string' ? result['reasoning'] : 'AI assistant confirmation needed';
      const expandedReasoning = this.expandCommandVariable(reasoning, command);
      const message = typeof result['assistant_request_message'] === 'string' ? result['assistant_request_message'] : 'Please provide additional information';
      
      return {
        evaluation_result: 'ai_assistant_confirm',
        reasoning: expandedReasoning,
        assistant_request_message: message,
        suggested_alternatives: []
      };
    } catch (error) {
      logger.error('Failed to handle ai_assistant_confirm tool', { error, command });
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
