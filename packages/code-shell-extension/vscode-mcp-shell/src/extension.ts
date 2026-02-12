import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  createShellToolRuntime,
  dispatchToolCall,
  TOOL_NAMES,
  type ToolName,
  type ToolParams,
  type ShellToolRuntime,
  type CreateMessageCallback,
  type ElicitationHandler
} from '@mako10k/mcp-shell-server/tool-runtime';

const PROVIDER_ID = 'mcp-shell-server.provider';
const SERVER_LABEL = 'MCP Shell Server';
const SERVER_VERSION = '2.7.0';
type ShellToolsApi = ShellToolRuntime['shellTools'];
type ServerManagerApi = ShellToolRuntime['serverManager'];

function getWorkspaceCwd(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.fsPath;
}

function getServerEntry(context: vscode.ExtensionContext): string {
  return path.join(
    context.extensionPath,
    'dist',
    'mcp-shell-server.js'
  );
}

let runtimePromise: Promise<ShellToolRuntime> | undefined;

function createVSCodeMessageCallback(): CreateMessageCallback {
  return async (request: Parameters<CreateMessageCallback>[0]) => {
    const models = await vscode.lm.selectChatModels({});
    const model = models[0];
    if (!model) {
      throw new Error('No VS Code language model is available for enhanced evaluation.');
    }

    const messages: vscode.LanguageModelChatMessage[] = [];
    if (request.systemPrompt) {
      messages.push(
        vscode.LanguageModelChatMessage.User(`[system]\n${request.systemPrompt}`)
      );
    }

    for (const message of request.messages) {
      if (message.role === 'tool') {
        continue;
      }
      if (message.role === 'user') {
        messages.push(vscode.LanguageModelChatMessage.User(message.content.text));
        continue;
      }
      messages.push(vscode.LanguageModelChatMessage.Assistant(message.content.text));
    }

    const response = await model.sendRequest(messages, {
      justification: 'Run MCP Shell Server enhanced safety evaluation via VS Code language model.'
    });

    let text = '';
    for await (const part of response.text) {
      text += part;
    }

    return {
      content: { type: 'text', text },
      model: model.id
    };
  };
}

function createVSCodeElicitationHandler(): ElicitationHandler {
  return async (request: Parameters<ElicitationHandler>[0]) => {
    const selection = await vscode.window.showWarningMessage(
      request.message,
      { modal: true },
      'Run',
      'Do not run',
      'Cancel'
    );

    if (!selection || selection === 'Cancel') {
      return { action: 'cancel' };
    }

    const confirmed = selection === 'Run';
    const reason = await vscode.window.showInputBox({
      prompt: confirmed
        ? 'Why do you need to run this command? (optional)'
        : 'Why are you declining this command? (optional)'
    });

    return {
      action: 'accept',
      content: {
        confirmed,
        reason: reason ?? ''
      }
    };
  };
}

async function getRuntime(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): Promise<ShellToolRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const serverEntry = getServerEntry(context);
      if (!fs.existsSync(serverEntry)) {
        const message = `MCP Shell Server entry not found at ${serverEntry}`;
        output.appendLine(message);
        throw new Error(message);
      }

      const workspaceCwd = getWorkspaceCwd();
      return createShellToolRuntime({
        defaultWorkingDirectory: workspaceCwd,
        createMessage: createVSCodeMessageCallback(),
        elicitationHandler: createVSCodeElicitationHandler()
      });
    })();
  }

  return runtimePromise;
}

class DirectShellTool implements vscode.LanguageModelTool<ToolParams> {
  constructor(
    private context: vscode.ExtensionContext,
    private output: vscode.OutputChannel,
    private toolName: ToolName
  ) {}

  private serverManager?: ServerManagerApi;

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ToolParams>
  ): Promise<vscode.PreparedToolInvocation> {
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
    const runtime = await getRuntime(this.context, this.output);
    if (!this.serverManager) {
      this.serverManager = runtime.serverManager;
    }
    const result = await dispatchToolCall(
      runtime.shellTools,
      runtime.serverManager,
      this.toolName,
      options.input,
      {
        defaultWorkingDirectory: resolveDefaultWorkingDirectory(),
        fallbackWorkingDirectory: process.cwd(),
      }
    );

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(result))
    ]);
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

  if (toolName.startsWith('server_')) {
    return new vscode.MarkdownString('Manage MCP Shell Server attachment?');
  }

  return new vscode.MarkdownString(`Run ${toolName}?`);
}

const resolveDefaultWorkingDirectory = (): string | undefined => getWorkspaceCwd();

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
    vscode.lm.registerTool(toolName, new DirectShellTool(context, output, toolName))
  );

  context.subscriptions.push(output, registration, ...toolRegistrations);
}

export async function deactivate() {
  if (runtimePromise) {
    try {
      const runtime = await runtimePromise;
      await runtime.cleanup();
    } catch (error) {
      // Avoid throwing on shutdown.
    }
  }
}
