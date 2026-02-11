import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const PROVIDER_ID = 'mcp-shell-server.provider';
const SERVER_LABEL = 'MCP Shell Server';
const SERVER_VERSION = '2.5.1';
const TOOL_SHELL_EXECUTE = 'shell_execute';

type McpClient = {
  connect: (transport: unknown) => Promise<void>;
  request: (request: {
    method: string;
    params: { name: string; arguments: Record<string, unknown> };
  }) => Promise<unknown>;
  close?: () => Promise<void> | void;
};

type ShellExecuteParams = {
  command: string;
  [key: string]: unknown;
};

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

class ShellExecuteTool implements vscode.LanguageModelTool<ShellExecuteParams> {
  constructor(
    private context: vscode.ExtensionContext,
    private output: vscode.OutputChannel
  ) {}

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ShellExecuteParams>
  ): Promise<vscode.LanguageModelToolInvocationPrepareResult> {
    const command = options.input?.command?.trim();
    const message = command
      ? new vscode.MarkdownString(`Run the following command?\n\n\`\`\`\n${command}\n\`\`\``)
      : new vscode.MarkdownString('Run a shell command?');

    return {
      invocationMessage: 'Executing shell command via MCP Shell Server',
      confirmationMessages: {
        title: 'Shell Execute',
        message
      }
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ShellExecuteParams>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const client = await createMcpClient(this.context, this.output);
    try {
      const result = await client.request({
        method: 'tools/call',
        params: {
          name: TOOL_SHELL_EXECUTE,
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
  const shellExecuteTool = new ShellExecuteTool(context, output);
  const toolRegistration = vscode.lm.registerTool(TOOL_SHELL_EXECUTE, shellExecuteTool);

  context.subscriptions.push(output, registration, toolRegistration);
}

export function deactivate() {
  // No-op: resources are disposed via subscriptions.
}
