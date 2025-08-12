import { CreateMessageCallback } from './common-llm-evaluator.js';
import { z } from 'zod';

const CCCMessageSchema = z.array(
  z.object({
    role: z.union([z.literal('system'), z.literal('user'), z.literal('assistant')]),
    content: z.string(),
    name: z.string().optional(),
  })
);

const CCCToolsSchema = z
  .array(
    z.object({
      type: z.literal('function'),
      function: z.object({
        name: z.string(),
        description: z.string(),
        parameters: z.object({
          type: z.literal('object'),
          properties: z.record(z.unknown()),
          required: z.array(z.string()).optional(),
        }),
      }),
    })
  );

const CCCRequestSchema = z.object({
  model: z.string(),
  messages: CCCMessageSchema,
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  stop: z.array(z.string()).optional(),
  top_p: z.number().optional(),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),
  tools: CCCToolsSchema.optional(),
  tool_choice: z
    .union([
      z.literal('none'),
      z.literal('auto'),
      z.object({ type: z.literal('function'), function: z.object({ name: z.string() }) }),
      z.object({ type: z.literal('tool'), name: z.string() }),
    ])
    .optional(),
});

type CCCRequest = z.infer<typeof CCCRequestSchema>;

const CCCResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        role: z.literal('assistant'),
        content: z.string(),
        tool_calls: z.array(
          z.object({
            id: z.string(),
            type: z.literal('function'),
            function: z.object({
              name: z.string(),
              arguments: z.string(),
            }),
          })
        ).optional(),
      }),
      finish_reason: z.union([
        z.literal('stop'),
        z.literal('length'),
        z.literal('tool_calls'),
      ]),
      index: z.number().optional(),
    })
  ),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
    })
    .optional(),
});

type CCCResponse = z.infer<typeof CCCResponseSchema>;

export class CCCToMCPCMAdapter {
  private createMessage: CreateMessageCallback;

  constructor(createMessage: CreateMessageCallback) {
    this.createMessage = createMessage;
  }

  // Update chatCompletion to handle optional properties explicitly
  async chatCompletion(request: CCCRequest): Promise<CCCResponse> {
    // Use the schemas for validation in chatCompletion
    CCCRequestSchema.parse(request);

    // Use adaptOpenAIRequestToMCP to convert the request
    const mcpRequest = adaptOpenAIRequestToMCP(request);

    const mcpResponse = await this.createMessage(mcpRequest);

    // Convert MCP response to OpenAI API format (do NOT parse with CCCResponseSchema yet)
    // Fix the type error by casting response.stopReason to the expected type
    const stopReason: 'stop' | 'length' | 'tool_calls' = (mcpResponse.stopReason as 'stop' | 'length' | 'tool_calls') || 'stop';

    const cccResponse: CCCResponse = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: mcpResponse.content.type === 'text' ? mcpResponse.content.text : 'Non-text response',
          },
          finish_reason: stopReason,
        },
      ],
    };

    // Now validate the converted response
    CCCResponseSchema.parse(cccResponse);

    return cccResponse;
  }
}

// Type for MCP Create Message Request (extracted from CreateMessageCallback)
type MCPCreateMessageRequest = Parameters<CreateMessageCallback>[0];

// Adapt OpenAI Request to MCP Request
export function adaptOpenAIRequestToMCP(request: CCCRequest): MCPCreateMessageRequest {
  // (1) Filter messages and extract SystemMessage
  const systemMessages = request.messages.filter(msg => msg.role === 'system');
  const filteredMessages: Array<{ role: 'user' | 'assistant', content: { type: 'text', text: string } }> = request.messages
    .filter(msg => msg.role !== 'system') // 'system' を除外
    .map(msg => ({
      role: msg.role as 'user' | 'assistant', // 明示的に型をキャスト
      content: { type: 'text', text: msg.content } // type を "text" に固定
    }));

  const toolNames = request.tools?.map(tool => tool.function.name) || [];

  // Convert tool_choice to string for system prompt generation
  const toolChoiceString = typeof request.tool_choice === 'string' 
    ? request.tool_choice 
    : request.tool_choice?.type === 'function' 
      ? request.tool_choice.function.name 
    : request.tool_choice?.type === 'tool'
      ? request.tool_choice.name
      : 'none';

  const systemPrompt = [
    ...systemMessages.map(msg => msg.content),
    createSystemPromptFromTools(toolNames, toolChoiceString),
  ].join('\n');

  // Generate MCPRequest (construct to fully satisfy the type)
  const mcpRequest: MCPCreateMessageRequest = {
    messages: filteredMessages,
    systemPrompt,
    includeContext: 'none',
    // Add tools if available (convert OpenAI format to MCP format)
    ...(request.tools && request.tools.length > 0 && { tools: request.tools }),
    // Add tool_choice if specified
    ...(request.tool_choice && request.tool_choice !== 'auto' && { tool_choice: request.tool_choice }),
  };

  // Conditionally add optional properties
  if (request.max_tokens !== undefined) {
    mcpRequest.maxTokens = request.max_tokens;
  }
  if (request.temperature !== undefined) {
    mcpRequest.temperature = request.temperature;
  }
  if (request.stop !== undefined) {
    mcpRequest.stopSequences = request.stop;
  }

  return mcpRequest;
}



// Generates a system prompt string based on the provided tools and tool choices.
/**
 * Creates a comprehensive system prompt from available tools and tool choice
 * Based on mcp-llm-generator implementation - OpenAI Function Calling standard
 */
export function createSystemPromptFromTools(tools: string[], toolChoice: string): string {
  // Handle case with no tools
  if (!tools || tools.length === 0) {
    return 'You are a helpful assistant. No tools are currently available for this request.';
  }

  // Build the system prompt with explicit Function Calling instructions
  // Based on Berkeley Function Calling Leaderboard best practices
  return `# System Instructions

You are a security evaluation assistant specialized in analyzing shell commands for safety.

## Critical Requirements
- You MUST respond using function calls ONLY
- NEVER provide text responses outside of function calls
- Always call exactly one function per response
- Your response MUST be a valid function call

## Available Functions
${tools.map(tool => `- ${tool}: Use this function to provide your evaluation`).join('\n')}

## Function Call Rules
${toolChoice && toolChoice !== 'none' && toolChoice !== 'auto' 
  ? `MANDATORY: You MUST call the "${toolChoice}" function for this request.` 
  : 'MANDATORY: Call the appropriate function to respond.'}

## Response Format Requirements (ABSOLUTE CRITICAL)

⚠️ WARNING: You are in FUNCTION CALLING MODE ONLY ⚠️

1. Your ENTIRE response must be a JSON function call - NO EXCEPTIONS
2. DO NOT write text like "evaluate_command_security(...)" 
3. DO NOT write explanations outside the function call
4. You MUST respond with this EXACT JSON structure:

{
  "tool_calls": [{
    "id": "call_123",
    "type": "function",
    "function": {
      "name": "evaluate_command_security",
      "arguments": "{\\"evaluation_result\\": \\"ALLOW\\", \\"reasoning\\": \\"Safe command\\", \\"requires_additional_context\\": {\\"command_history_depth\\": 0, \\"execution_results_count\\": 0, \\"user_intent_search_keywords\\": null, \\"user_intent_question\\": null}, \\"suggested_alternatives\\": []}"
    }
  }]
}

5. Replace the arguments with your actual evaluation
6. All required fields MUST be included: evaluation_result, reasoning, requires_additional_context, suggested_alternatives

## Security Evaluation Guidelines
When creating your function call:
- evaluation_result: ALLOW, CONDITIONAL_DENY, DENY, or NEED_MORE_INFO
- reasoning: Detailed security analysis
- requires_additional_context: Use the specified object structure
- suggested_alternatives: Array of alternative commands (can be empty)

🚨 CRITICAL: Function call JSON format is MANDATORY. Any text response will be REJECTED. 🚨`;
}

