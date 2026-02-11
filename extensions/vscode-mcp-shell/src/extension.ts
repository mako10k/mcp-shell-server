import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const PROVIDER_ID = 'mcp-shell-server.provider';
const SERVER_LABEL = 'MCP Shell Server';
const SERVER_VERSION = '2.5.1';
const TOOL_NAMES = [
  'shell_execute',
  'process_get_execution',
  'shell_set_default_workdir',
  'list_execution_outputs',
  'read_execution_output',
  'delete_execution_outputs',
  'get_cleanup_suggestions',
  'perform_auto_cleanup',
  'terminal_operate',
  'terminal_list',
  'terminal_get_info',
  'terminal_close',
  'command_history_query'
] as const;

type ToolName = (typeof TOOL_NAMES)[number];

type McpClient = {
  connect: (transport: unknown) => Promise<void>;
  request: (request: {
    method: string;
    params: { name: string; arguments: Record<string, unknown> };
  }) => Promise<unknown>;
  close?: () => Promise<void> | void;
};

type ToolParams = Record<string, unknown>;

function getWorkspaceCwd(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.fsPath;
}

function getServerEntry(context: vscode.ExtensionContext): string {
  return path.join(
    context.extensionPath,
    'node_modules',
    '@mako10k',
    'mcp-shell-server',
    'dist',
    'index.js'
  );
}

async function createMcpClient(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): Promise<McpClient> {
  const serverEntry = getServerEntry(context);
  if (!fs.existsSync(serverEntry)) {
    const message = `MCP Shell Server entry not found at ${serverEntry}`;
    output.appendLine(message);
    throw new Error(message);
  }

  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js')
  ]);

  const workspaceCwd = getWorkspaceCwd() ?? context.extensionPath;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: process.env,
    cwd: workspaceCwd
  });

  const client = new Client(
    { name: 'vscode-mcp-shell-tools', version: SERVER_VERSION },
    { capabilities: {} }
  ) as McpClient;

  await client.connect(transport);
  return client;
}

class McpBridgeTool implements vscode.LanguageModelTool<ToolParams> {
  constructor(
    private context: vscode.ExtensionContext,
    private output: vscode.OutputChannel,
    private toolName: ToolName
  ) {}

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ToolParams>
  ): Promise<vscode.LanguageModelToolInvocationPrepareResult> {
    const message = buildConfirmationMessage(this.toolName, options.input);

    return {
      invocationMessage: `Executing ${this.toolName} via MCP Shell Server`,
      confirmationMessages: {
        title: `MCP Shell Server: ${this.toolName}`,
        message
      }
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ToolParams>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const client = await createMcpClient(this.context, this.output);
    try {
      const result = await client.request({
        method: 'tools/call',
        params: {
          name: this.toolName,
          arguments: options.input
        }
      });

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify(result))
      ]);
    } finally {
      if (client.close) {
        await client.close();
      }
    }
  }
}

function buildConfirmationMessage(toolName: ToolName, input?: ToolParams): vscode.MarkdownString {
  if (!input) {
    return new vscode.MarkdownString('Run MCP Shell Server tool?');
  }

  if (toolName === 'shell_execute') {
    const command = typeof input.command === 'string' ? input.command.trim() : '';
    return command
      ? new vscode.MarkdownString(`Run the following command?\n\n\`\`\`\n${command}\n\`\`\``)
      : new vscode.MarkdownString('Run a shell command?');
  }

  if (toolName === 'terminal_operate') {
    const command = typeof input.command === 'string' ? input.command.trim() : '';
    const text = command ? `Terminal command: ${command}` : 'Operate a terminal session?';
    return new vscode.MarkdownString(text);
  }

  if (toolName === 'delete_execution_outputs') {
    return new vscode.MarkdownString('Delete execution output files?');
  }

  if (toolName === 'perform_auto_cleanup') {
    return new vscode.MarkdownString('Perform automatic cleanup of execution outputs?');
  }

  return new vscode.MarkdownString(`Run ${toolName}?`);
}

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel(SERVER_LABEL);
  output.appendLine('Registering MCP server definition provider.');

  const provider: vscode.McpServerDefinitionProvider<vscode.McpServerDefinition> = {
    provideMcpServerDefinitions: async () => {
      const serverEntry = getServerEntry(context);
      if (!fs.existsSync(serverEntry)) {
        const message = `MCP Shell Server entry not found at ${serverEntry}`;
        output.appendLine(message);
        vscode.window.showErrorMessage(message);
        return [];
      }

      const server = new vscode.McpStdioServerDefinition(
        SERVER_LABEL,
        process.execPath,
        [serverEntry],
        {},
        SERVER_VERSION
      );

      const workspaceCwd = getWorkspaceCwd() ?? context.extensionPath;
      server.cwd = vscode.Uri.file(workspaceCwd);

      return [server];
    }
  };

  const registration = vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, provider);
  const toolRegistrations = TOOL_NAMES.map((toolName) =>
    vscode.lm.registerTool(toolName, new McpBridgeTool(context, output, toolName))
  );

  context.subscriptions.push(output, registration, ...toolRegistrations);
}

export function deactivate() {
  // No-op: resources are disposed via subscriptions.
}
