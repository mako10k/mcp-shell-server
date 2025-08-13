import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';

// OpenAI compatible tool definitions
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type ToolDefinitions = Array<ToolDefinition>;

// CreateMessageCallback interface supporting tools
export interface CreateMessageCallback {
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
    tools?: ToolDefinitions;
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
        content: z.string().nullable(), // Function calls can have null content
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

  constructor(server: Server) {
    this.createMessage = createMessageCallbackFromMCPServer(server);
  }

  // Update chatCompletion to handle optional properties explicitly
  async chatCompletion(request: CCCRequest): Promise<CCCResponse> {
    // Use the schemas for validation in chatCompletion
    CCCRequestSchema.parse(request);

    // Use adaptOpenAIRequestToMCP to convert the request
    const mcpRequest = adaptOpenAIRequestToMCP(request);

    const mcpResponse = await this.createMessage(mcpRequest);

    // Parse Function Calls from MCP response if present
    let toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> | undefined;
    let content: string | null = null;
    let finishReason: 'stop' | 'length' | 'tool_calls' = 'stop';

    if (mcpResponse.content.type === 'text') {
      const responseText = mcpResponse.content.text;

      // Use flexible parsing
      const parseResult = await this.parseFlexibleResponse(responseText, request);

      if (parseResult.toolCalls) {
        toolCalls = parseResult.toolCalls;
        finishReason = 'tool_calls';
        content = null;
      } else {
        content = parseResult.content || responseText;
        finishReason = 'stop';
      }
    } else {
      content = 'Non-text response';
      finishReason = 'stop';
    }

    // Override with actual stopReason if available
    if (mcpResponse.stopReason) {
      finishReason = (mcpResponse.stopReason as 'stop' | 'length' | 'tool_calls');
    }

    const cccResponse: CCCResponse = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: content,
            ...(toolCalls && { tool_calls: toolCalls }),
          },
          finish_reason: finishReason,
        },
      ],
    };

    // Now validate the converted response
    CCCResponseSchema.parse(cccResponse);

    return cccResponse;
  }

  /**
   * Flexible response parsing inspired by content-parser.ts
   * Handles various LLM response formats including content-based and tool_calls-based responses
   */
  private async parseFlexibleResponse(responseText: string, request: CCCRequest): Promise<{
    toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    content?: string;
  }> {
    // Try to extract JSON objects from the response
    const jsonObjects = this.extractJsonObjects(responseText);

    // Look for Function Call patterns
    for (const obj of jsonObjects) {
      // Type guard for object
      if (!this.isValidObject(obj)) continue;
      
      const objRecord = obj as Record<string, unknown>;

      // Standard OpenAI format: {"tool_calls": [...]}
      if (this.hasToolCalls(objRecord)) {
        const toolCalls = this.parseToolCallsArray(objRecord['tool_calls']);
        if (toolCalls.length > 0) {
          return { toolCalls };
        }
      }

      // Check if this looks like direct function arguments
      if (request.tools && request.tools.length > 0) {
        const expectedTool = this.getExpectedTool(request);
        if (expectedTool && this.looksLikeFunctionArgs(objRecord, expectedTool)) {
          const toolCall = this.createToolCallFromArgs(expectedTool.function.name, objRecord);
          return { toolCalls: [toolCall] };
        }
      }
    }

    // Special case: Check if the entire response text is a JSON string containing tool_calls
    const directToolCalls = await this.tryParseDirectToolCalls(responseText);
    if (directToolCalls) {
      return { toolCalls: directToolCalls };
    }

    // No valid function calls found, return as content
    return { content: responseText };
  }

  // Type guard functions
  private isValidObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private hasToolCalls(obj: Record<string, unknown>): boolean {
    return !!obj['tool_calls'] && Array.isArray(obj['tool_calls']);
  }

  private isString(value: unknown): value is string {
    return typeof value === 'string';
  }

  private isValidToolCall(call: unknown): call is Record<string, unknown> {
    return this.isValidObject(call);
  }

  private isValidFunction(func: unknown): func is Record<string, unknown> {
    return this.isValidObject(func);
  }

  // Helper functions for parsing
  private parseToolCallsArray(toolCallsData: unknown): Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> {
    if (!Array.isArray(toolCallsData)) return [];

    return toolCallsData
      .filter(this.isValidToolCall.bind(this))
      .map(call => this.parseToolCall(call));
  }

  private parseToolCall(call: Record<string, unknown>): { id: string; type: 'function'; function: { name: string; arguments: string } } {
    const id = this.extractStringValue(call['id']) || this.generateCallId();
    const functionData = call['function'];
    
    if (!this.isValidFunction(functionData)) {
      return this.createDefaultToolCall(id);
    }

    const name = this.extractStringValue(functionData['name']) || 'unknown_function';
    const args = this.extractArguments(functionData['arguments']);

    return {
      id,
      type: 'function' as const,
      function: { name, arguments: args }
    };
  }

  private extractStringValue(value: unknown): string | null {
    return this.isString(value) ? value : null;
  }

  private extractArguments(args: unknown): string {
    if (this.isString(args)) {
      return args;
    }
    return JSON.stringify(args || {});
  }

  private generateCallId(): string {
    return `call_${Math.random().toString(36).substr(2, 15)}`;
  }

  private createDefaultToolCall(id: string): { id: string; type: 'function'; function: { name: string; arguments: string } } {
    return {
      id,
      type: 'function' as const,
      function: { name: 'unknown_function', arguments: '{}' }
    };
  }

  private createToolCallFromArgs(functionName: string, args: Record<string, unknown>): { id: string; type: 'function'; function: { name: string; arguments: string } } {
    return {
      id: this.generateCallId(),
      type: 'function' as const,
      function: {
        name: functionName,
        arguments: JSON.stringify(args)
      }
    };
  }

  private async tryParseDirectToolCalls(responseText: string): Promise<Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> | null> {
    try {
      const parsed = JSON.parse(responseText);
      if (this.isValidObject(parsed) && this.hasToolCalls(parsed)) {
        return this.parseToolCallsArray(parsed['tool_calls']);
      }
    } catch (parseError) {
      // Try with JSON repair if standard parsing fails
      try {
        const { repairAndParseJson } = await import('../utils/json-repair.js');
        const repairResult = repairAndParseJson(responseText);

        if (repairResult.success && this.isValidObject(repairResult.value)) {
          const valueObj = repairResult.value;
          if (this.hasToolCalls(valueObj)) {
            return this.parseToolCallsArray(valueObj['tool_calls']);
          }
        }
      } catch (repairError) {
        // JSON repair also failed, continue with other methods
      }
    }
    return null;
  }

  /**
   * Extract JSON objects from text, handling various formats
   */
  private extractJsonObjects(text: string): unknown[] {
    const objects: unknown[] = [];

    // Try parsing the entire text as JSON first
    try {
      const parsed = JSON.parse(text);
      objects.push(parsed);
      return objects;
    } catch {
      // Continue with extraction methods
    }

    // Look for JSON objects in code blocks or plain text
    const jsonPatterns = [
      /```json\s*(\{[\s\S]*?\})\s*```/g,
      /```\s*(\{[\s\S]*?\})\s*```/g,
      /(\{[^{}]*\{[^{}]*\}[^{}]*\})/g, // Nested objects
      /(\{[^{}]+\})/g // Simple objects
    ];

    for (const pattern of jsonPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const jsonText = match[1];
        if (jsonText) {
          try {
            const parsed = JSON.parse(jsonText);
            objects.push(parsed);
          } catch {
            // Invalid JSON, continue
          }
        }
      }
    }

    return objects;
  }

  /**
   * Get the expected tool from request
   */
  private getExpectedTool(request: CCCRequest): { function: { name: string; parameters?: Record<string, unknown> } } | null {
    if (!request.tools || request.tools.length === 0) return null;

    // If tool_choice specifies a function, use that
    if (request.tool_choice && typeof request.tool_choice === 'object' && 'function' in request.tool_choice) {
      const toolChoice = request.tool_choice as { function: { name: string } };
      return request.tools.find(tool => tool.function.name === toolChoice.function.name) || null;
    }

    // Otherwise use the first tool
    return request.tools[0] || null;
  }

  /**
   * Check if an object looks like function arguments for the expected tool
   */
  private looksLikeFunctionArgs(obj: Record<string, unknown>, expectedTool: { function: { name: string; parameters?: Record<string, unknown> } }): boolean {
    // Get expected parameter names from tool schema
    const expectedParams = expectedTool.function.parameters?.['properties'] as Record<string, unknown> | undefined;
    if (!expectedParams) return true; // If no schema, assume it's valid

    const expectedKeys = Object.keys(expectedParams);
    const objKeys = Object.keys(obj);

    // Check if at least some expected keys are present
    const hasExpectedKeys = expectedKeys.some(key => objKeys.includes(key));

    return hasExpectedKeys;
  }
}

// Adapt OpenAI Request to MCP Request
export function adaptOpenAIRequestToMCP(request: CCCRequest) {
  // (1) Filter messages and extract SystemMessage
  const systemMessages = request.messages.filter(msg => msg.role === 'system');
  const filteredMessages: Array<{ role: 'user' | 'assistant', content: { type: 'text', text: string } }> = request.messages
    .filter(msg => msg.role !== 'system') // 'system' を除外
    .map(msg => ({
      role: msg.role as 'user' | 'assistant', // 明示的に型をキャスト
      content: { type: 'text', text: msg.content } // type を "text" に固定
    }));

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
    createSystemPromptFromTools(request.tools || [], toolChoiceString),
  ].join('\n');

  // Define MCPCreateMessageRequest type locally (or import from correct module if available)
  type MCPCreateMessageRequest = {
    messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }>;
    systemPrompt?: string;
    includeContext?: 'none' | 'thisServer' | 'allServers';
    tools?: ToolDefinitions;
    tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } } | { type: 'tool'; name: string };
    maxTokens?: number;
    temperature?: number;
    stopSequences?: string[];
  };

  // Generate MCPRequest with type-safe approach
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
 * Based on OpenAI Function Calling standard format
 */
export function createSystemPromptFromTools(
  tools: ToolDefinitions,
  toolChoice: string
): string {
  // Handle case with no tools
  if (!tools || tools.length === 0) {
    return 'You are a helpful assistant. No tools are currently available for this request.';
  }

  // Build the system prompt with explicit Function Calling instructions
  // Based on OpenAI Function Calls specification
  return `# Function Calling Assistant

⚠️ **CRITICAL JSON REQUIREMENT**: All JSON responses MUST be properly escaped to prevent parsing errors.

You are a helpful assistant that responds using function calls when tools are available.

## Available Functions
${tools.map(tool => `- ${tool.function.name}: ${tool.function.description}`).join('\n')}

## Function Call Requirements
${toolChoice && toolChoice !== 'none' && toolChoice !== 'auto'
      ? `You MUST call the "${toolChoice}" function for this request.`
      : 'You MUST use function calls to respond when appropriate.'}

## Function Schemas
${tools.map(tool => `
### ${tool.function.name}
- Description: ${tool.function.description}
- Parameters: ${JSON.stringify(tool.function.parameters, null, 2)}
`).join('\n')}

## Response Format
When making function calls, respond with a JSON object containing a "tool_calls" array:

{
  "tool_calls": [
    {
      "id": "call_[random_string]",
      "type": "function",
      "function": {
        "name": "[function_name]",
        "arguments": "[json_string_with_arguments]"
      }
    }
  ]
}

## Critical JSON Formatting Requirements

### JSON Escaping Rules (MANDATORY)
- **Double Quotes**: Always escape with \\" inside JSON strings
- **Backslashes**: Always escape with \\\\ inside JSON strings  
- **Newlines**: Use \\n for line breaks in JSON strings
- **Tab Characters**: Use \\t for tabs in JSON strings

### Function Call Structure
- The "id" field should be "call_" followed by a random string
- The "type" field must always be "function"  
- The "arguments" field must be a valid JSON string (not an object)
- Multiple function calls can be made by adding more objects to the tool_calls array
- Ensure your function arguments match the required schema exactly
- **ALL string values in arguments must follow the escaping rules above**

Make function calls as needed to fulfill the user's request.`;
}
/**
 * Create a CreateMessageCallback from an MCP Server instance
 */
function createMessageCallbackFromMCPServer(server: Server): CreateMessageCallback {
  return async (request: Parameters<CreateMessageCallback>[0]) => {
    try {
      // Convert request to MCP format
      const mcpMessages = request.messages
        .filter((msg: { role: string }) => msg.role !== 'tool') // Filter out tool messages as MCP doesn't support them
        .map((msg: { role: string; content: { text: string } }) => ({
          role: (msg.role as 'user' | 'assistant'),
          content: { type: 'text' as const, text: msg.content.text },
        }));

      // Create MCP request with only defined values
      const mcpRequest: Record<string, unknown> = {
        messages: mcpMessages,
        includeContext: request.includeContext || 'none',
      };

      if (request.maxTokens !== undefined) {
        mcpRequest['maxTokens'] = request.maxTokens;
      }
      if (request.temperature !== undefined) {
        mcpRequest['temperature'] = request.temperature;
      }
      if (request.systemPrompt !== undefined) {
        mcpRequest['systemPrompt'] = request.systemPrompt;
      }

      // Call MCP createMessage method with type assertion
      const result = await server.createMessage(mcpRequest as Parameters<typeof server.createMessage>[0]);

      // Build response object conditionally
      const response: {
        content: { type: 'text'; text: string; };
        model?: string;
        stopReason?: string;
        tool_calls?: Array<{
          id: string;
          type: 'function';
          function: { name: string; arguments: string; };
        }>;
      } = {
        content: { type: 'text', text: String(result.content?.text || '') },
      };

      if (result.model) {
        response.model = result.model;
      }
      if (result.stopReason) {
        response.stopReason = result.stopReason;
      }
      if (result['tool_calls']) {
        const toolCalls = result['tool_calls'] as Array<{
          type: 'function';
          function: { name: string; arguments: string; };
        }>;
        response.tool_calls = toolCalls.map((call, index) => ({
          id: `call_${index}`, // Generate ID for compatibility
          ...call,
        }));
      }

      return response;
    } catch (error) {
      console.error('Error in createMessageCallbackFromMCPServer:', error);
      throw error;
    }
  };
}
// Tools for Function Calling (external use only)
// import { securityEvaluationTool } from './security-tools.js';
// MCP sampling protocol interface (matches manager.ts implementation)
export interface CreateMessageCallback {
  (request: {
    messages: Array<{
      role: 'user' | 'assistant' | 'tool';
      content: { type: 'text'; text: string; };
      tool_call_id?: string;
    }>;
    maxTokens?: number;
    temperature?: number;
    systemPrompt?: string;
    includeContext?: 'none' | 'thisServer' | 'allServers';
    stopSequences?: string[];
    metadata?: Record<string, unknown>;
    modelPreferences?: Record<string, unknown>;
    tools?: ToolDefinitions;
    tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string; }; } | { type: 'tool'; name: string; };
  }): Promise<{
    content: { type: 'text'; text: string; };
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


