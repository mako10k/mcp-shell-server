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

    // Parse Function Calls from MCP response if present
    let toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> | undefined;
    let content: string | null = null;
    let finishReason: 'stop' | 'length' | 'tool_calls' = 'stop';

    if (mcpResponse.content.type === 'text') {
      const responseText = mcpResponse.content.text;
      
      // Use flexible parsing
      const parseResult = this.parseFlexibleResponse(responseText, request);
      
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
  private parseFlexibleResponse(responseText: string, request: CCCRequest): {
    toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    content?: string;
  } {
    // Try to extract JSON objects from the response
    const jsonObjects = this.extractJsonObjects(responseText);
    
    // Look for Function Call patterns
    for (const obj of jsonObjects) {
      // Type guard for object
      if (typeof obj !== 'object' || obj === null) continue;
      const objRecord = obj as Record<string, unknown>;
      
      // Standard OpenAI format: {"tool_calls": [...]}
      if (objRecord['tool_calls'] && Array.isArray(objRecord['tool_calls'])) {
        return {
          toolCalls: objRecord['tool_calls'].map((call: unknown) => {
            const callObj = call as Record<string, unknown>;
            const functionObj = callObj['function'] as Record<string, unknown> | undefined;
            return {
              id: (callObj['id'] as string) || `call_${Math.random().toString(36).substr(2, 15)}`,
              type: 'function' as const,
              function: {
                name: (functionObj?.['name'] as string) || 'unknown_function',
                arguments: typeof functionObj?.['arguments'] === 'string' 
                  ? functionObj['arguments'] 
                  : JSON.stringify(functionObj?.['arguments'] || {})
              }
            };
          })
        };
      }
      
      // Check if this looks like direct function arguments
      if (request.tools && request.tools.length > 0) {
        const expectedTool = this.getExpectedTool(request);
        if (expectedTool && this.looksLikeFunctionArgs(objRecord, expectedTool)) {
          return {
            toolCalls: [{
              id: `call_${Math.random().toString(36).substr(2, 15)}`,
              type: 'function' as const,
              function: {
                name: expectedTool.function.name,
                arguments: JSON.stringify(objRecord)
              }
            }]
          };
        }
      }
    }
    
    // No valid function calls found, return as content
    return { content: responseText };
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
 * Based on OpenAI Function Calling standard format
 */
export function createSystemPromptFromTools(
  tools: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[] | undefined;
      };
    };
  }>, 
  toolChoice: string
): string {
  // Handle case with no tools
  if (!tools || tools.length === 0) {
    return 'You are a helpful assistant. No tools are currently available for this request.';
  }

  // Build the system prompt with explicit Function Calling instructions
  // Based on OpenAI Function Calls specification
  return `# Function Calling Assistant

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

## Important Notes
- The "id" field should be "call_" followed by a random string
- The "type" field must always be "function"
- The "arguments" field must be a JSON string (not an object)
- Multiple function calls can be made by adding more objects to the tool_calls array
- Ensure your function arguments match the required schema exactly

Make function calls as needed to fulfill the user's request.`;
}

