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
      z.object({ type: z.literal('function'), function: z.object({ name: z.string() }) }),
    ])
    .optional(),
  function_call: z.string().optional(),
});

type CCCRequest = z.infer<typeof CCCRequestSchema>;

const CCCResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        role: z.literal('assistant'),
        content: z.string(),
        function_call: z
          .object({
            name: z.string(),
            arguments: z.string(),
          })
          .optional(),
      }),
      finish_reason: z.union([
        z.literal('stop'),
        z.literal('length'),
        z.literal('function_call'),
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

  // Updated helper function to handle content and role conversion
  private convertCCCRequestMessagesToMCPCMMessages(requestMessages: CCCRequest['messages']): Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }> {
    return requestMessages
      .filter(message => message.role !== 'system') // Exclude 'system' role as it's not supported
      .map(message => ({
        role: message.role as 'user' | 'assistant', // Cast role to the expected type
        content: { type: 'text', text: message.content }, // Wrap content in the expected structure
      }));
  }

  private generateFilteredMessages(requestMessages: CCCRequest['messages']) {
    return requestMessages
      .filter(message => message.role !== 'system') // Exclude 'system' role
      .map(message => ({
        role: message.role as 'user' | 'assistant',
        content: { type: 'text', text: message.content },
      }));
  }

  // Update chatCompletion to handle optional properties explicitly
  async chatCompletion(request: CCCRequest): Promise<CCCResponse> {
    const convertedMessages = this.convertCCCRequestMessagesToMCPCMMessages(request.messages);

    const filteredMessages = this.generateFilteredMessages(request.messages).map(message => ({
      ...message,
      content: { ...message.content, type: 'text' }, // Ensure type is explicitly 'text'
    }));
    CCCMessageSchema.parse(filteredMessages); // Validate using zod schema

    // Use the schemas for validation in chatCompletion
    CCCRequestSchema.parse(request);

    const response = await this.createMessage({
      messages: convertedMessages,
      maxTokens: request.max_tokens ?? 0, // Provide a default value if undefined
      temperature: request.temperature ?? 0.7, // Provide a default value if undefined
      systemPrompt: request.model,
      stopSequences: request.stop ?? [], // Provide an empty array if undefined
      includeContext: 'none',
    });

    CCCResponseSchema.parse(response);

    // Fix the type error by casting response.stopReason to the expected type
    const stopReason: 'stop' | 'length' | 'function_call' = (response.stopReason as 'stop' | 'length' | 'function_call') || 'stop';

    return {
      choices: [
        {
          message: {
            role: 'assistant',
            content: response.content.text,
          },
          finish_reason: stopReason,
        },
      ],
    };
  }
}

// Define the Tool interface
interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

// Define the ToolCall and ToolResponse interfaces
interface ToolCall {
  tool_name: string;
  arguments: Record<string, unknown>;
  confidence: number;
  reasoning: string;
}

interface ToolResponse {
  should_call_tool: boolean;
  tool_calls: ToolCall[];
  response_text: string;
  metadata?: {
    processing_time?: number;
    model_used?: string;
    confidence_score?: number;
  };
}

// Function to execute a tool call
function executeToolCall(tool: Tool, params: Record<string, unknown>): Record<string, unknown> {
  if (!tool || typeof tool !== 'object') {
    throw new Error('Invalid tool object');
  }
  return Object.entries(params).reduce((acc: Record<string, unknown>, [key, value]) => {
    acc[key] = value;
    return acc;
  }, {});
}

// Example tool execution handler
async function handleToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolResponse> {
  try {
    switch (toolName) {
      case 'example-tool':
        const result = executeToolCall({
          type: 'function',
          function: {
            name: 'example-tool',
            description: 'An example tool',
            parameters: {
              type: 'object',
              properties: {
                exampleParam: { type: 'string' },
              },
              required: ['exampleParam'],
            },
          },
        }, args);
        return {
          should_call_tool: true,
          tool_calls: [
            {
              tool_name: 'example-tool',
              arguments: args,
              confidence: 1.0,
              reasoning: 'Example reasoning',
            },
          ],
          response_text: JSON.stringify(result),
        };
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    return {
      should_call_tool: false,
      tool_calls: [],
      response_text: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// Example usage of handleToolCall to avoid unused function error
(async () => {
  const exampleResponse = await handleToolCall('example-tool', { exampleParam: 'test' });
  console.log('Example Tool Response:', exampleResponse);
})();

// Adapt OpenAI Request to MCP Request
export function adaptOpenAIRequestToMCP(request: CCCRequest): MCPCreateMessageRequest {
  // (1) messages のフィルターと SystemMessage 抽出
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
      : 'none';

  const systemPrompt = [
    ...systemMessages,
    createSystemPromptFromTools(toolNames, toolChoiceString),
  ].join('\n');

  // (3) metadata は不要
  const metadata = null;

  // (4) user は捨てる
  // 処理不要（無視）

  // (5) functions, function_call のシミュレーション
  const modelPreferences = {
    function_call: request.function_call || 'auto'
  };

  // MCPRequest の生成
  return {
    messages: filteredMessages,
    maxTokens: request.max_tokens,
    temperature: request.temperature,
    systemPrompt,
    stopSequences: request.stop,
    metadata,
    modelPreferences
  };
}

// Zod schema for MCPCreateMessageRequest
const MCPCreateMessageRequestSchema = z.object({
  messages: z.array(
    z.object({
      role: z.union([z.literal('user'), z.literal('assistant')]),
      content: z.object({
        type: z.literal('text'),
        text: z.string(),
      }),
    })
  ),
  maxTokens: z.number().optional(),
  temperature: z.number().optional(),
  systemPrompt: z.string().optional(),
  stopSequences: z.array(z.string()).optional(),
  includeContext: z.union([
    z.literal('none'),
    z.literal('thisServer'),
    z.literal('allServers'),
  ]).optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  modelPreferences: z.record(z.unknown()).optional(),
});

// Type definition from Zod schema
type MCPCreateMessageRequest = z.infer<typeof MCPCreateMessageRequestSchema>;

// Generates a system prompt string based on the provided tools and tool choices.
/**
 * Creates a comprehensive system prompt from available tools and tool choice
 * Based on the implementation pattern from mcp-llm-generator
 */
export function createSystemPromptFromTools(tools: string[], toolChoice: string): string {
  // Handle case with no tools
  if (!tools || tools.length === 0) {
    return buildBasePrompt() + '\n\nNo tools are currently available for this request.';
  }

  // Build tool descriptions
  const toolDescriptions = generateToolDescriptions(tools);
  
  // Build tool choice information
  const toolChoiceInfo = generateToolChoiceInfo(toolChoice);
  
  // Build constraints and guidelines
  const constraints = generateToolUsageConstraints();
  
  // Assemble the complete system prompt
  return assembleSystemPrompt({
    basePrompt: buildBasePrompt(),
    toolDescriptions,
    toolChoiceInfo,
    constraints
  });
}

/**
 * Builds the base system prompt with core responsibilities
 */
function buildBasePrompt(): string {
  return `You are a precision tool call analyzer designed to determine when and how to use available tools.

Your core responsibilities:
1. Analyze user requests to determine if tool usage is required
2. Select the most appropriate tool based on the request context
3. Generate proper tool calls with correct parameters
4. Provide clear reasoning for tool selection decisions
5. Handle tool execution results and provide meaningful responses`;
}

/**
 * Generates detailed descriptions for available tools
 */
function generateToolDescriptions(tools: string[]): string {
  const descriptions = tools.map(tool => {
    // Enhanced tool description based on tool name patterns
    const description = getToolDescription(tool);
    const usageHint = getToolUsageHint(tool);
    
    return `## ${tool}
**Description**: ${description}
**Usage**: ${usageHint}`;
  }).join('\n\n');

  return `## Available Tools\n\n${descriptions}`;
}

/**
 * Gets enhanced description for a tool based on its name
 */
function getToolDescription(toolName: string): string {
  // Pattern-based tool description generation
  if (toolName.includes('shell') || toolName.includes('execute')) {
    return 'Execute shell commands securely with intelligent output handling and safety validation.';
  }
  if (toolName.includes('file') || toolName.includes('read') || toolName.includes('write')) {
    return 'Perform file operations including reading, writing, and manipulation with proper error handling.';
  }
  if (toolName.includes('search') || toolName.includes('grep') || toolName.includes('find')) {
    return 'Search and locate information within files, directories, or content with various search patterns.';
  }
  if (toolName.includes('terminal')) {
    return 'Manage terminal sessions and interactive command execution with persistent state.';
  }
  if (toolName.includes('process') || toolName.includes('monitor')) {
    return 'Monitor and manage system processes with detailed execution tracking and control.';
  }
  
  // Generic description for unknown tools
  return `A specialized tool for ${toolName} functionality with comprehensive error handling and validation.`;
}

/**
 * Gets usage hint for a tool based on its name patterns
 */
function getToolUsageHint(toolName: string): string {
  if (toolName.includes('shell') || toolName.includes('execute')) {
    return 'Call this tool when you need to execute system commands, run scripts, or perform system-level operations.';
  }
  if (toolName.includes('file')) {
    return 'Call this tool when you need to read, write, create, or modify files in the filesystem.';
  }
  if (toolName.includes('search')) {
    return 'Call this tool when you need to find specific content, patterns, or information within files or directories.';
  }
  if (toolName.includes('terminal')) {
    return 'Call this tool when you need interactive command execution or persistent terminal sessions.';
  }
  if (toolName.includes('process')) {
    return 'Call this tool when you need to monitor, control, or get information about running processes.';
  }
  
  return `Call this tool when you need to perform ${toolName}-related operations.`;
}

/**
 * Generates tool choice information section
 */
function generateToolChoiceInfo(toolChoice: string): string {
  if (!toolChoice || toolChoice === 'none' || toolChoice === 'None') {
    return `## Tool Selection Strategy
**Current Selection**: No specific tool enforced
**Strategy**: Analyze the request and select the most appropriate tool based on user intent and context.`;
  }
  
  return `## Tool Selection Strategy
**Preferred Tool**: ${toolChoice}
**Strategy**: Prioritize the specified tool when appropriate, but consider alternatives if the request context suggests a better match.`;
}

/**
 * Generates tool usage constraints and guidelines
 */
function generateToolUsageConstraints(): string {
  return `## Tool Usage Guidelines

**Safety First**:
- Always validate parameters before tool execution
- Consider potential security implications of each tool call
- Provide clear error handling and user feedback

**Best Practices**:
- Use the most specific tool for the task at hand
- Provide detailed reasoning for tool selection
- Handle edge cases and error conditions gracefully
- Optimize for user safety and system security

**Parameter Validation**:
- Ensure all required parameters are provided
- Validate parameter types and formats
- Use safe defaults when appropriate
- Sanitize user inputs to prevent security issues`;
}

/**
 * Assembles the complete system prompt from all components
 */
function assembleSystemPrompt(components: {
  basePrompt: string;
  toolDescriptions: string;
  toolChoiceInfo: string;
  constraints: string;
}): string {
  const { basePrompt, toolDescriptions, toolChoiceInfo, constraints } = components;
  
  return `${basePrompt}

${toolDescriptions}

${toolChoiceInfo}

${constraints}

## Response Format
When using tools, provide clear explanations of:
1. Why the selected tool is appropriate
2. What parameters are being used and why
3. Expected outcomes and potential alternatives
4. Any safety considerations or limitations

Always prioritize user safety and system security in your tool usage decisions.`;
}

