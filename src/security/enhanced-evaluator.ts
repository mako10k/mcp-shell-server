import { CommandHistoryEntry, EvaluationResult, SimplifiedLLMEvaluationResult } from '../types/enhanced-security.js';
import { CommandSafetyEvaluationResult, SecurityManager } from './manager.js';
import { CommandHistoryManager } from '../core/enhanced-history-manager.js';
import { getCurrentTimestamp, generateId } from '../utils/helpers.js';
import { ElicitResultSchema } from '@modelcontextprotocol/sdk/types.js';

// Structured Output imports
import { SecurityResponseParser, SecurityParserConfig } from './security-response-parser.js';
import { SecurityLLMPromptGenerator } from './security-llm-prompt-generator.js';
import {
  CommonEvaluationContext,
} from './common-llm-evaluator.js';

// MCP sampling protocol interface (matches manager.ts implementation)
interface CreateMessageCallback {
  (request: {
    messages: Array<{
      role: 'user' | 'assistant';
      content: { type: 'text'; text: string };
    }>;
    maxTokens?: number;
    temperature?: number;
    systemPrompt?: string;
    includeContext?: 'none' | 'thisServer' | 'allServers';
    stopSequences?: string[];
    metadata?: Record<string, unknown>;
    modelPreferences?: Record<string, unknown>;
  }): Promise<{
    content: { type: 'text'; text: string };
    model?: string | undefined;
    stopReason?: string | undefined;
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
  private responseParser: SecurityResponseParser;
  private promptGenerator: SecurityLLMPromptGenerator;
  private securityManager: SecurityManager;
  private historyManager: CommandHistoryManager;
  private mcpServer: MCPServerInterface | undefined;

  constructor(
    securityManager: SecurityManager,
    historyManager: CommandHistoryManager,
    createMessageCallback?: CreateMessageCallback,
    mcpServer?: MCPServerInterface,
    parserConfig?: SecurityParserConfig
  ) {
    this.securityManager = securityManager;
    this.historyManager = historyManager;
    this.mcpServer = mcpServer;

    // Initialize parser and generator
    const parser = new SecurityResponseParser(parserConfig);
    const generator = new SecurityLLMPromptGenerator();

    this.responseParser = parser;
    this.promptGenerator = generator;

    // Use placeholder callback if not provided - will be set later via setCreateMessageCallback
    this.createMessageCallback =
      createMessageCallback ||
      (() => {
        throw new Error('LLM evaluation attempted before createMessageCallback was set');
      });
  }

  setCreateMessageCallback(callback: CreateMessageCallback | undefined): void {
    if (callback) {
      this.createMessageCallback = callback;
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
    let maxIteration = 5;
    try {
      while (true) {
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
                "AI Assistantによるユーザ確認の強制：この操作を実行してもよろしいですか？",
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
                "AI Assistantによるユーザ確認の強制：この操作を実行してもよろしいですか？",
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
      console.error('LLM-centric evaluation failed:', error);
      return {
        evaluation_result: 'CONDITIONAL_DENY',
        safety_level: 0.2,
        basic_classification: 'evaluation_error',
        reasoning: 'LLM-centric evaluation failed',
        requires_confirmation: false,
        suggested_alternatives: [],
        llm_evaluation_used: true,
      };
    }
  }

  /**
   * Call LLM for evaluation with Structured Output (using common implementation)
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

    // Generate prompt for initial security evaluation
    const { systemPrompt, userMessage } = this.promptGenerator.generateSecurityEvaluationPrompt(promptContext);

    // Call LLM with structured output
    try {
      const response = await this.createMessageCallback({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: userMessage,
            },
          },
        ],
        maxTokens: 300,
        temperature: 0.1,
        systemPrompt,
      });

      // Parse response using simplified schema
      const requestId = generateId();
      const parseResult = await this.responseParser.parseSimplifiedSecurityEvaluation(
        response.content.text,
        requestId
      );

      if (parseResult.success && parseResult.data) {
        return parseResult.data;
      } else {
        console.warn('Failed to parse LLM response, using fallback:', parseResult.errors);
        return this.createFallbackEvaluation(response.content.text);
      }
    } catch (error) {
      console.error('LLM evaluation failed:', error);
      return this.createFallbackEvaluation('LLM evaluation failed');
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
   * Create fallback evaluation when Structured Output parsing fails
   */
  private createFallbackEvaluation(
    rawResponse: string,
    _model?: string
  ): LLMEvaluationResult {
    // Use the original simple parsing logic as fallback
    const llmResponse = rawResponse.trim().toUpperCase();
    let evaluation_result: EvaluationResult;

    if (llmResponse.includes('NEED_MORE_INFO')) {
      evaluation_result = 'NEED_MORE_INFO';
    } else if (llmResponse.includes('DENY') && !llmResponse.includes('CONDITIONAL_DENY')) {
      evaluation_result = 'DENY';
    } else if (llmResponse.includes('CONDITIONAL_DENY')) {
      evaluation_result = 'CONDITIONAL_DENY';
    } else if (llmResponse.includes('ALLOW')) {
      evaluation_result = 'ALLOW';
    } else {
      // Default to safe denial for unclear responses
      evaluation_result = 'CONDITIONAL_DENY';
      console.warn('LLM evaluation response unclear, defaulting to CONDITIONAL_DENY:', llmResponse);
    }

    return {
      evaluation_result,
      reasoning: rawResponse,
      requires_additional_context: {
        command_history_depth: 0,
        execution_results_count: 0,
        user_intent_search_keywords: null,
        user_intent_question: null
      },
      suggested_alternatives: [],
    };
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
