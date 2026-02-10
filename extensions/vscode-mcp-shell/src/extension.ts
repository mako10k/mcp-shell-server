import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const PROVIDER_ID = 'mcp-shell-server.provider';
const SERVER_LABEL = 'MCP Shell Server';
const SERVER_VERSION = '2.5.1';

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

  context.subscriptions.push(output, registration);
}

export function deactivate() {
  // No-op: resources are disposed via subscriptions.
}
