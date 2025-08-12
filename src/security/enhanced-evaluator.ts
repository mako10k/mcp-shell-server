import { 
  CommandHistoryEntry, 
  EvaluationResult, 
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
import { CCCToMCPCMAdapter } from './chat-completion-adapter.js';
import { ElicitResultSchema } from '@modelcontextprotocol/sdk/types.js';

// Structured Output imports (minimal usage for fallback only)
import { SecurityLLMPromptGenerator } from './security-llm-prompt-generator.js';
import {
  CommonEvaluationContext,
} from './common-llm-evaluator.js';

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

// LLM evaluation result (using simplified structure)
interface LLMEvaluationResult extends SimplifiedLLMEvaluationResult { }

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
  evaluation_result: EvaluationResult;
  safety_level: number;
  // Removed confidence property
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
        evaluation_result: basicAnalysis.classification === 'basic_safe' ? 'ALLOW' : 'CONDITIONAL_DENY',
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
   * LLM-centric evaluation flow (simple and clean)
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
    
    let maxIteration = 5;
    try {
      while (true) {
        logger.debug('LLM Evaluation iteration', {
          remainingIterations: maxIteration
        });
        
        if (maxIteration <= 0) {
          return {
            evaluation_result: 'CONDITIONAL_DENY',
            safety_level: 0.3,
            basic_classification: 'timeout_fallback',
            reasoning: 'Maximum iterations reached - fallback to safe denial',
            requires_confirmation: false,
            suggested_alternatives: [],
            llm_evaluation_used: true,
          };
        }
        maxIteration--;
        const llmResult = await this.callLLMForEvaluation(
          command,
          workingDirectory,
          history,
          comment
        );

        switch (llmResult.evaluation_result) {
          case 'ALLOW':
          case 'CONDITIONAL_DENY':
          case 'DENY':
            // If force user confirm is enabled, always trigger ELICITATION regardless of LLM result
            if (forceUserConfirm) {
              return await this._handleUserIntentElicitation(
                command,
                workingDirectory,
                history,
                "AI Assistant forced user confirmation: Do you want to proceed with this operation?",
                comment
              );
            }
            
            // Check for user intent question in the new schema structure
            if (llmResult.requires_additional_context?.user_intent_question) {
              return await this._handleUserIntentElicitation(
                command, 
                workingDirectory, 
                history,
                llmResult.requires_additional_context.user_intent_question,
                comment
              );
            }
            return this.llmResultToSafetyEvaluation(
              llmResult,
              'llm_required'
            );

          case 'NEED_MORE_INFO':
            // If force user confirm is enabled, always trigger ELICITATION
            if (forceUserConfirm) {
              return await this._handleUserIntentElicitation(
                command,
                workingDirectory,
                history,
                "AI Assistant forced user confirmation: Do you want to proceed with this operation?",
                comment
              );
            }
            // Handle additional context request (history, execution results, etc.)
            return await this.handleMoreInfoRequest(command, workingDirectory, history, comment);

          default:
            // Fallback for unknown results
            return {
              evaluation_result: 'CONDITIONAL_DENY',
              safety_level: 0.3,
              basic_classification: 'unknown_response',
              reasoning: 'Unknown LLM response - defaulting to safe denial',
              requires_confirmation: false,
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
   * Call LLM for evaluation using Function Calling - PROPER IMPLEMENTATION
   * LLM directly returns the evaluation result as function call arguments
   */
  private async callLLMForEvaluation(
    command: string,
    workingDirectory: string,
    history: CommandHistoryEntry[],
    comment?: string
  ): Promise<LLMEvaluationResult> {
    const historyContext = history
      .slice(0, 5)
      .map((entry) => entry.command)
      .filter((cmd) => cmd && cmd.trim().length > 0);

    const promptContext = {
      command,
      commandHistory: historyContext,
      workingDirectory,
      ...(comment && { comment }),
    };

    // Generate prompt for security evaluation with Function Calling
    const { systemPrompt, userMessage } = this.promptGenerator.generateSecurityEvaluationPrompt(promptContext);

    try {
      logger.debug('Pre-LLM Debug', {
        createMessageCallbackAvailable: !!this.createMessageCallback,
        systemPromptLength: systemPrompt?.length || 0,
        userMessageLength: userMessage?.length || 0,
        command
      });

      if (!this.chatAdapter) {
        logger.error('CRITICAL ERROR: chatAdapter is not set - LLM evaluation cannot proceed');
        throw new Error('chatAdapter is not set');
      }

      // Import the security evaluation tool here to avoid circular imports
      const { securityEvaluationTool } = await import('./security-tools.js');
      logger.debug('Security tool imported successfully');

      logger.debug('About to call LLM with Function Calling', {
        systemPromptLength: systemPrompt?.length || 0,
        userMessageLength: userMessage?.length || 0,
        systemPromptPreview: systemPrompt?.substring(0, 500) + '...',
        fullSystemPrompt: systemPrompt,
        securityTool: JSON.stringify(securityEvaluationTool, null, 2),
        toolChoice: JSON.stringify({ type: 'function', function: { name: 'evaluate_command_security' } }, null, 2)
      });

      // Use ChatCompletionAdapter with OpenAI API compatible format
      const response = await this.chatAdapter.chatCompletion({
        model: 'gpt-4-turbo',  // Required by OpenAI API format
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: userMessage
          }
        ],
        max_tokens: 500,
        temperature: 0.1,
        tools: [securityEvaluationTool],
        tool_choice: { type: 'function', function: { name: 'evaluate_command_security' } }
      });
      logger.debug('LLM call completed successfully');

      // Debug: Log the complete LLM response for analysis
      const firstChoice = response.choices?.[0];
      const message = firstChoice?.message;
      
      logger.debug('=== COMPLETE LLM RESPONSE DEBUG ===', {
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
        if (toolCall && toolCall.function.name === 'evaluate_command_security') {
          try {
            // Parse and validate the function arguments
            const rawArgs = toolCall.function.arguments;
            let result;
            
            try {
              result = JSON.parse(rawArgs);
            } catch (parseError) {
              throw new Error(`JSON parse failed: ${parseError}. Raw: ${rawArgs.substring(0, 100)}...`);
            }
            
            // Validate required fields (now only evaluation_result and reasoning)
            const missingFields = [];
            if (!result.evaluation_result) missingFields.push('evaluation_result');
            if (!result.reasoning) missingFields.push('reasoning');
            
            // If basic fields are missing, this is a critical Function Call failure
            if (missingFields.length > 0) {
              throw new Error(`Function Call missing required fields: ${missingFields.join(', ')}. Received: ${Object.keys(result).join(', ')}`);
            }
            
            // LLM directly provides the evaluation - no need to execute anything
            return {
              evaluation_result: result.evaluation_result,
              reasoning: result.reasoning,
              requires_additional_context: result.requires_additional_context || {
                command_history_depth: 0,
                execution_results_count: 0,
                user_intent_search_keywords: null,
                user_intent_question: null
              },
              suggested_alternatives: result.suggested_alternatives || []
            };
          } catch (parseError) {
            console.error('Function Call argument parsing error:', parseError);
            console.error('Raw arguments:', toolCall.function.arguments);
            throw new Error(`Function Call argument parsing failed: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
          }
        }
      }

      // If no tool calls, this is a critical failure - log detailed information
      logger.error('CRITICAL: LLM did not return Function Call', {
        responseContent: message?.content || '',
        responseStopReason: firstChoice?.finish_reason,
        systemPromptUsed: systemPrompt,
        toolsProvided: JSON.stringify([securityEvaluationTool], null, 2),
        userMessage: userMessage,
        command: command
      });

      throw new Error('No valid tool call in response - Function Calling is required');
    } catch (error) {
      // NO FALLBACK - Function Call must succeed
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('=== Exception Caught in LLM Evaluation ===');
      console.error('Error type:', error?.constructor?.name || 'Unknown');
      console.error('Error message:', errorMessage);
      if (error instanceof Error) {
        console.error('Error stack:', error.stack);
      }
      console.error('Command that caused error:', command);
      console.error('createMessageCallback available:', !!this.createMessageCallback);
      console.error('=== End Exception Debug ===');
      
      throw new Error(`Function Call evaluation failed: ${errorMessage}`);
    }
  }

  /**
   * Handle user intent elicitation
   */
  private async _handleUserIntentElicitation(
    command: string,
    workingDirectory: string,
    history: CommandHistoryEntry[],
    userIntentQuestion: string,
    comment?: string
  ): Promise<SafetyEvaluation> {
    try {
      const { userIntent, elicitationResponse } = await this.elicitUserIntent(command, userIntentQuestion);

      if (userIntent && elicitationResponse?.action === 'accept') {
        // Re-evaluate with user intent
        const llmResult = await this.callLLMForEvaluationWithUserIntent(
          command,
          workingDirectory,
          history,
          userIntent,
          comment
        );

        const finalEval = this.llmResultToSafetyEvaluation(llmResult, 'llm_required');
        finalEval.user_confirmation_required = true;
        finalEval.user_response = elicitationResponse.content || {};
        finalEval.confirmation_message = 'User intent confirmed';
        return finalEval;
      } else {
        // User declined or cancelled
        return {
          evaluation_result: 'CONDITIONAL_DENY',
          safety_level: 0.3,
          basic_classification: 'user_declined',
          reasoning: 'User declined intent confirmation',
          requires_confirmation: false,
          suggested_alternatives: [],
          llm_evaluation_used: true,
        };
      }
    } catch (error) {
      console.error('User intent elicitation failed:', error);
      return {
        evaluation_result: 'CONDITIONAL_DENY',
        safety_level: 0.2,
        basic_classification: 'elicitation_error',
        reasoning: 'Intent elicitation failed - requiring manual confirmation',
        requires_confirmation: false,
        suggested_alternatives: [],
        llm_evaluation_used: true,
      };
    }
  }

  /**
   * Handle more info request from LLM
   */
  private async handleMoreInfoRequest(
    command: string,
    workingDirectory: string,
    _history: CommandHistoryEntry[], // Marked as unused with underscore
    comment?: string
  ): Promise<SafetyEvaluation> {
    try {
      // Get more command history
      const config = this.securityManager.getEnhancedConfig();
      const moreHistory = await this.historyManager.searchHistory({
        limit: config.max_additional_history_for_context || 20,
      });

      // Re-evaluate with more context
      const llmResult = await this.callLLMForEvaluationWithMoreInfo(
        command,
        workingDirectory,
        moreHistory,
        comment
      );

      return this.llmResultToSafetyEvaluation(llmResult, 'llm_required');
    } catch (error) {
      console.error('More info evaluation failed:', error);
      return {
        evaluation_result: 'CONDITIONAL_DENY',
        safety_level: 0.2,
        basic_classification: 'additional_context_error',
        reasoning: 'Additional context evaluation failed - requiring manual confirmation',
        requires_confirmation: false,
        suggested_alternatives: [],
        llm_evaluation_used: true,
      };
    }
  }

  /**
   * Call LLM with user intent context using Structured Output (using common implementation)
   */
  private async callLLMForEvaluationWithUserIntent(
    command: string,
    _workingDirectory: string,
    _history: CommandHistoryEntry[],
    _userIntent: UserIntentData,
    comment?: string
  ): Promise<LLMEvaluationResult> {
    const context: CommonEvaluationContext = {
      command,
      workingDirectory: _workingDirectory,
      ...(comment && { comment }),
    };

    // For now, simply re-evaluate with basic context
    // TODO: Implement proper user intent evaluation using userIntent data
    return await this.callLLMForEvaluation(
      context.command,
      context.workingDirectory || '',
      [],
      context.comment
    );
  }

  /**
   * Call LLM with additional context using Structured Output (using common implementation)
   */
  private async callLLMForEvaluationWithMoreInfo(
    command: string,
    workingDirectory: string,
    _history: CommandHistoryEntry[],
    comment?: string
  ): Promise<LLMEvaluationResult> {
    // For now, simply re-evaluate with additional context
    // TODO: Implement proper additional context evaluation using history data
    return await this.callLLMForEvaluation(
      command,
      workingDirectory,
      [],
      comment
    );
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
    // Filter out unsupported evaluation results
    let evaluation_result: 'ALLOW' | 'CONDITIONAL_DENY' | 'DENY';
    
    switch (safetyEval.evaluation_result) {
      case 'ALLOW':
        evaluation_result = 'ALLOW';
        break;
      case 'DENY':
        evaluation_result = 'DENY';
        break;
      case 'NEED_MORE_INFO':
      case 'CONDITIONAL_DENY':
      default:
        evaluation_result = 'CONDITIONAL_DENY';
        break;
    }

    return {
      evaluation_result,
      reasoning: safetyEval.reasoning,
      requires_confirmation: safetyEval.requires_confirmation,
      suggested_alternatives: safetyEval.suggested_alternatives,
      llm_evaluation_used: safetyEval.llm_evaluation_used,
    };
  }

  /**
   * Convert LLM result to SafetyEvaluation
   */
  private llmResultToSafetyEvaluation(
    llmResult: LLMEvaluationResult,
    classification: string
  ): SafetyEvaluation {
    return {
      evaluation_result: llmResult.evaluation_result,
      safety_level: 0.7, 
      basic_classification: classification,
      reasoning: llmResult.reasoning,
      requires_confirmation: llmResult.evaluation_result === 'CONDITIONAL_DENY',
      suggested_alternatives: [],
      llm_evaluation_used: true,
    };
  }
}
