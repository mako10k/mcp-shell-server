import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  createShellToolRuntime,
  resolveShellExecuteIntent,
  resolveTerminalOperateIntent,
  type ExecutionConfirmation,
  type ShellExecuteIntent,
  type ShellToolRuntime,
  type TerminalOperateIntent,
  type CreateMessageCallback,
  type ElicitationHandler
} from '@mako10k/mcp-shell-server/tool-runtime';

const PROVIDER_ID = 'mcp-shell-server.provider';
const SERVER_LABEL = 'MCP Shell Server';
const SERVER_VERSION = '2.8.1';
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

type ToolParams = Record<string, unknown>;

type ShellToolsApi = ShellToolRuntime['shellTools'];

function getWorkspaceCwd(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.fsPath;
}

function getServerEntry(context: vscode.ExtensionContext): string {
  return path.join(
    context.extensionPath,
    'dist',
    'mcp-shell-server',
    'dist',
    'index.mjs'
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
    const executionIntent = resolveInvocationIntent(this.toolName, options.input);
    const runtime = await getRuntime(this.context, this.output);
    const result = await dispatchToolCall(
      runtime.shellTools,
      this.toolName,
      options.input,
      executionIntent
    );

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(result))
    ]);
  }
}

function buildConfirmationMessage(toolName: ToolName, input?: ToolParams): vscode.MarkdownString {
  if (toolName === 'shell_execute') {
    return renderExecutionConfirmation(resolveShellExecuteIntent(input ?? {}).confirmation);
  }

  if (toolName === 'terminal_operate') {
    return renderExecutionConfirmation(resolveTerminalOperateIntent(input ?? {}).confirmation);
  }

  if (!input) {
    return new vscode.MarkdownString('Run MCP Shell Server tool?');
  }

  if (toolName === 'delete_execution_outputs') {
    return new vscode.MarkdownString('Delete execution output files?');
  }

  if (toolName === 'perform_auto_cleanup') {
    return new vscode.MarkdownString('Perform automatic cleanup of execution outputs?');
  }

  return new vscode.MarkdownString(`Run ${toolName}?`);
}

function renderExecutionConfirmation(confirmation: ExecutionConfirmation): vscode.MarkdownString {
  const message = new vscode.MarkdownString();
  message.appendText(confirmation.summary);

  for (const payload of confirmation.payloads) {
    message.appendMarkdown('\n\n');
    message.appendText(`${payload.label}:`);
    message.appendMarkdown('\n\n');
    message.appendCodeblock(payload.value, 'text');
  }

  if (confirmation.details.length > 0) {
    message.appendMarkdown('\n\n');
    message.appendText('Resolved execution details:');
    for (const detail of confirmation.details) {
      message.appendMarkdown('\n\n- ');
      message.appendText(`${detail.label}: ${detail.value}`);
    }
  }

  return message;
}

type DirectExecutionIntent = ShellExecuteIntent | TerminalOperateIntent;

function resolveInvocationIntent(
  toolName: ToolName,
  input?: ToolParams
): DirectExecutionIntent | undefined {
  if (toolName === 'shell_execute') {
    return resolveShellExecuteIntent(input ?? {});
  }
  if (toolName === 'terminal_operate') {
    return resolveTerminalOperateIntent(input ?? {});
  }
  return undefined;
}

async function dispatchToolCall(
  shellTools: ShellToolsApi,
  toolName: ToolName,
  params?: ToolParams,
  executionIntent?: DirectExecutionIntent
): Promise<unknown> {
  switch (toolName) {
    case 'shell_execute': {
      if (executionIntent?.kind !== 'shell_execute') {
        throw new Error('Resolved shell execution intent is required');
      }
      return shellTools.executeShellIntent(executionIntent);
    }
    case 'process_get_execution':
      return shellTools.getExecutionValidated(params ?? {});
    case 'shell_set_default_workdir':
      return shellTools.setDefaultWorkingDirectoryValidated(params ?? {});
    case 'list_execution_outputs':
      return shellTools.listFilesValidated(params ?? {});
    case 'read_execution_output':
      return shellTools.readFileValidated(params ?? {});
    case 'delete_execution_outputs':
      return shellTools.deleteFilesValidated(params ?? {});
    case 'get_cleanup_suggestions':
      return shellTools.getCleanupSuggestionsValidated(params ?? {});
    case 'perform_auto_cleanup':
      return shellTools.performAutoCleanupValidated(params ?? {});
    case 'terminal_operate': {
      if (executionIntent?.kind !== 'terminal_operate') {
        throw new Error('Resolved terminal operation intent is required');
      }
      return shellTools.terminalOperateIntent(executionIntent);
    }
    case 'terminal_list':
      return shellTools.listTerminalsValidated(params ?? {});
    case 'terminal_get_info':
      return shellTools.getTerminalValidated(params ?? {});
    case 'terminal_close':
      return shellTools.closeTerminalValidated(params ?? {});
    case 'command_history_query':
      return shellTools.queryCommandHistoryValidated(params ?? {});
    default:
      throw new Error(`Unsupported tool: ${toolName}`);
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
