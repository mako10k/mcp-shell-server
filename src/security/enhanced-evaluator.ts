import { CommandHistoryEntry, EvaluationResult } from '../types/enhanced-security.js';
import { SecurityManager } from './manager.js';
import { CommandHistoryManager } from '../core/enhanced-history-manager.js';
import { getCurrentTimestamp, generateId } from '../utils/helpers.js';
import { ElicitResultSchema } from '@modelcontextprotocol/sdk/types.js';

// Structured Output imports
import { SecurityResponseParser, SecurityParserConfig } from './security-response-parser.js';
import { SecurityLLMPromptGenerator } from './security-llm-prompt-generator.js';
import { 
  CommonLLMEvaluator,
  CommonLLMEvaluationResult,
  CommonEvaluationContext
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
  type: "object";
  properties: Record<string, {
    type: string;
    title?: string;
    description?: string;
    minimum?: number;
    maximum?: number;
    enum?: string[];
    [key: string]: unknown;
  }>;
  required?: string[];
}

interface ElicitationResponse {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
}

// MCP Server interface for elicitation
interface MCPServerInterface {
  request(request: { method: string; params?: Record<string, unknown> }, schema?: unknown): Promise<unknown>;
}

// LLM evaluation result (using common interface)
interface LLMEvaluationResult extends CommonLLMEvaluationResult {}

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
  confidence: number;
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
 * Enhanced Safety Evaluator - LLM-Centric Design
 * Simple implementation focusing on LLM decision making without algorithmic complexity
 * Now extends CommonLLMEvaluator to reduce code duplication
 */
export class EnhancedSafetyEvaluator extends CommonLLMEvaluator {
  private securityManager: SecurityManager;
  private historyManager: CommandHistoryManager;
  private mcpServer: MCPServerInterface | undefined;
  private enablePatternFiltering: boolean = false;

  constructor(
    securityManager: SecurityManager,
    historyManager: CommandHistoryManager,
    createMessageCallback?: CreateMessageCallback,
    mcpServer?: MCPServerInterface,
    parserConfig?: SecurityParserConfig
  ) {
    // Initialize parent class with shared components
    const parser = new SecurityResponseParser(parserConfig);
    const generator = new SecurityLLMPromptGenerator();
    
    // Use placeholder callback if not provided - will be set later via setCreateMessageCallback
    const callback = createMessageCallback || (() => {
      throw new Error('LLM evaluation attempted before createMessageCallback was set');
    });
    
    super(callback, parser, generator);
    
    this.securityManager = securityManager;
    this.historyManager = historyManager;
    this.mcpServer = mcpServer;
  }

  setCreateMessageCallback(callback: CreateMessageCallback | undefined): void {
    if (callback) {
      this.createMessageCallback = callback;
    }
  }

  setMCPServer(server: MCPServerInterface | undefined): void {
    this.mcpServer = server;
  }

  setPatternFiltering(enabled: boolean): void {
    this.enablePatternFiltering = enabled;
  }

  /**
   * Simple LLM-centric command safety evaluation
   */
  async evaluateCommand(
    command: string,
    workingDirectory: string,
    contextSize: number = 10,
    comment?: string
  ): Promise<SafetyEvaluation> {
    // Step 1: Basic safety classification
    const basicClassification = this.enablePatternFiltering 
      ? this.securityManager.classifyCommandSafety(command)
      : 'llm_required';
    
    // Step 2: If basic_safe, execute immediately
    if (basicClassification === 'basic_safe') {
      return {
        evaluation_result: 'ALLOW',
        safety_level: 1,
        confidence: 0.95,
        basic_classification: basicClassification,
        reasoning: 'Basic safe command - immediate execution',
        requires_confirmation: false,
        suggested_alternatives: [],
        llm_evaluation_used: false
      };
    }

    // Step 3: LLM evaluation for llm_required commands
    if (!this.createMessageCallback) {
      // Fallback when LLM not available
      return {
        evaluation_result: 'CONDITIONAL_DENY',
        safety_level: 3,
        confidence: 0.5,
        basic_classification: basicClassification,
        reasoning: 'LLM evaluation not available - requiring confirmation for safety',
        requires_confirmation: true,
        suggested_alternatives: [],
        llm_evaluation_used: false
      };
    }

    // Get initial command history for context
    const historyEntries = await this.historyManager.searchHistory({
      limit: contextSize
    });

    return await this.performLLMCentricEvaluation(
      command,
      workingDirectory,
      historyEntries,
      comment
    );
  }

  /**
   * LLM-centric evaluation flow (simple and clean)
   */
  private async performLLMCentricEvaluation(
    command: string,
    workingDirectory: string,
    history: CommandHistoryEntry[],
    comment?: string
  ): Promise<SafetyEvaluation> {
    try {
      // Step 1: Initial LLM evaluation
      const llmResult = await this.callLLMForEvaluation(
        command,
        workingDirectory,
        history,
        comment
      );

      // Step 2: Handle LLM response based on result
      switch (llmResult.evaluation_result) {
        case 'ALLOW':
        case 'CONDITIONAL_DENY':
        case 'DENY':
          // Final decisions - return directly
          return this.createFinalEvaluation(llmResult, 'llm_required');

        case 'ELICIT_USER_INTENT':
          // Handle user intent elicitation
          return await this.handleUserIntentElicitation(
            command,
            workingDirectory,
            history,
            comment
          );

        case 'NEED_MORE_INFO':
          // Handle additional context request
          return await this.handleMoreInfoRequest(
            command,
            workingDirectory,
            history,
            comment
          );

        default:
          // Fallback for unknown results
          return this.createFinalEvaluation({
            evaluation_result: 'CONDITIONAL_DENY',
            confidence: 0.3,
            llm_reasoning: 'Unknown LLM response - defaulting to safe denial',
            model: 'unknown',
            evaluation_time_ms: Date.now()
          }, 'llm_required');
      }
    } catch (error) {
      console.error('LLM-centric evaluation failed:', error);
      return this.createFinalEvaluation(
        this.createErrorEvaluation(error instanceof Error ? error.message : 'Unknown error'), 
        'llm_required'
      );
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
      .map(entry => entry.command)
      .filter(cmd => cmd && cmd.trim().length > 0);

    const context: CommonEvaluationContext = {
      command,
      workingDirectory,
      ...(comment && { comment })
    };

    return this.evaluateInitialSecurity(context, historyContext);
  }

  /**
   * Handle user intent elicitation
   */
  private async handleUserIntentElicitation(
    command: string,
    workingDirectory: string,
    history: CommandHistoryEntry[],
    comment?: string
  ): Promise<SafetyEvaluation> {
    try {
      const { userIntent, elicitationResponse } = await this.elicitUserIntent(command);
      
      if (userIntent && elicitationResponse?.action === 'accept') {
        // Re-evaluate with user intent
        const llmResult = await this.callLLMForEvaluationWithUserIntent(
          command,
          workingDirectory,
          history,
          userIntent,
          comment
        );
        
        const finalEval = this.createFinalEvaluation(llmResult, 'llm_required');
        finalEval.user_confirmation_required = true;
        finalEval.user_response = elicitationResponse.content || {};
        finalEval.confirmation_message = 'User intent confirmed';
        return finalEval;
      } else {
        // User declined or cancelled
        return this.createFinalEvaluation(
          this.createErrorEvaluation('User declined intent confirmation', 'user_decision'), 
          'llm_required'
        );
      }
    } catch (error) {
      console.error('User intent elicitation failed:', error);
      return this.createFinalEvaluation(
        this.createErrorEvaluation('Intent elicitation failed - requiring manual confirmation'), 
        'llm_required'
      );
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
        limit: config.max_additional_history_for_context || 20
      });

      // Re-evaluate with more context
      const llmResult = await this.callLLMForEvaluationWithMoreInfo(
        command,
        workingDirectory,
        moreHistory,
        comment
      );

      return this.createFinalEvaluation(llmResult, 'llm_required');
    } catch (error) {
      console.error('More info evaluation failed:', error);
      return this.createFinalEvaluation(
        this.createErrorEvaluation('Additional context evaluation failed - requiring manual confirmation'), 
        'llm_required'
      );
    }
  }

  /**
   * Call LLM with user intent context using Structured Output (using common implementation)
   */
  private async callLLMForEvaluationWithUserIntent(
    command: string,
    _workingDirectory: string,
    _history: CommandHistoryEntry[],
    userIntent: UserIntentData,
    comment?: string
  ): Promise<LLMEvaluationResult> {
    const context: CommonEvaluationContext = {
      command,
      workingDirectory: _workingDirectory,
      ...(comment && { comment })
    };

    const userResponse = `Intent: ${userIntent.intent}, Justification: ${userIntent.justification}`;
    const initialEvaluation = {
      evaluation_result: 'ELICIT_USER_INTENT',
      reasoning: 'User intent was requested'
    };

    return this.evaluateWithUserIntent(context, userResponse, initialEvaluation);
  }

  /**
   * Call LLM with additional context using Structured Output (using common implementation)
   */
  private async callLLMForEvaluationWithMoreInfo(
    command: string,
    workingDirectory: string,
    history: CommandHistoryEntry[],
    comment?: string
  ): Promise<LLMEvaluationResult> {
    const additionalHistory = history
      .slice(0, 15)
      .map(entry => entry.command)
      .filter(cmd => cmd && cmd.trim().length > 0);

    const context: CommonEvaluationContext = {
      command,
      workingDirectory,
      ...(comment && { comment })
    };

    const initialEvaluation = {
      evaluation_result: 'NEED_MORE_INFO',
      reasoning: 'Additional context was requested'
    };

    return this.evaluateWithAdditionalContext(context, additionalHistory, initialEvaluation);
  }

  /**
   * Elicit user intent using MCP protocol
   */
  private async elicitUserIntent(command: string): Promise<{userIntent: UserIntentData | null, elicitationResponse: ElicitationResponse | null}> {
    if (!this.securityManager.getEnhancedConfig().elicitation_enabled) {
      console.warn('User intent elicitation is disabled');
      return { userIntent: null, elicitationResponse: null };
    }

    if (!this.mcpServer) {
      throw new Error('MCP server not available for elicitation');
    }

    const elicitationMessage = `🔐 SECURITY CONFIRMATION REQUIRED

Command: ${command}

This command has been flagged for review. Please provide your intent:

- What are you trying to accomplish?
- Why is this specific command needed?
- Are you sure this is what you want to execute?`;

    const elicitationSchema: ElicitationSchema = {
      type: "object",
      properties: {
        confirmed: {
          type: "boolean",
          title: "Execute this command?",
          description: "Select 'Yes' if you understand the risks and want to proceed"
        },
        reason: {
          type: "string",
          title: "Why do you need to run this command?",
          description: "Briefly explain your intent"
        }
      },
      required: ["confirmed"]
    };

    try {
      const requestPayload = {
        method: 'elicitation/create',
        params: {
          message: elicitationMessage,
          requestedSchema: elicitationSchema,
          timeoutMs: 180000,
          level: 'question'
        }
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
            elicitation_id: generateId()
          };

          return { 
            userIntent, 
            elicitationResponse: { action: 'accept', content: result.content }
          };
        } else {
          return { 
            userIntent: null, 
            elicitationResponse: { action: result.action as "decline" | "cancel" }
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
  protected override createFallbackEvaluation(
    rawResponse: string,
    model?: string
  ): LLMEvaluationResult {
    // Use the original simple parsing logic as fallback
    const llmResponse = rawResponse.trim().toUpperCase();
    let evaluation_result: EvaluationResult;
    let confidence = 0.8;

    if (llmResponse.includes('ELICIT_USER_INTENT')) {
      evaluation_result = 'ELICIT_USER_INTENT';
      confidence = 0.6;
    } else if (llmResponse.includes('NEED_MORE_INFO')) {
      evaluation_result = 'NEED_MORE_INFO';
      confidence = 0.6;
    } else if (llmResponse.includes('DENY') && !llmResponse.includes('CONDITIONAL_DENY')) {
      evaluation_result = 'DENY';
      confidence = 0.9;
    } else if (llmResponse.includes('CONDITIONAL_DENY')) {
      evaluation_result = 'CONDITIONAL_DENY';
      confidence = 0.8;
    } else if (llmResponse.includes('ALLOW')) {
      evaluation_result = 'ALLOW';
      confidence = 0.9;
    } else {
      // Default to safe denial for unclear responses
      evaluation_result = 'CONDITIONAL_DENY';
      confidence = 0.3;
      console.warn('LLM evaluation response unclear, defaulting to CONDITIONAL_DENY:', llmResponse);
    }

    return {
      evaluation_result,
      confidence,
      llm_reasoning: rawResponse,
      model: model || 'unknown',
      evaluation_time_ms: Date.now()
    };
  }

  /**
   * Create final evaluation result
   */
  private createFinalEvaluation(
    llmResult: LLMEvaluationResult,
    basicClassification: string
  ): SafetyEvaluation {
    // Map evaluation result to safety level
    let safety_level: number;
    switch (llmResult.evaluation_result) {
      case 'ALLOW':
        safety_level = 1;
        break;
      case 'CONDITIONAL_DENY':
        safety_level = 3;
        break;
      case 'DENY':
        safety_level = 5;
        break;
      default:
        safety_level = 3;
    }

    return {
      evaluation_result: llmResult.evaluation_result,
      safety_level,
      confidence: llmResult.confidence,
      basic_classification: basicClassification,
      reasoning: llmResult.llm_reasoning,
      requires_confirmation: llmResult.evaluation_result === 'CONDITIONAL_DENY',
      suggested_alternatives: [], // Keep simple for now
      llm_evaluation_used: true
    };
  }
}
