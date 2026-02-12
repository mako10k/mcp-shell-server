# VS Code Language Model Tools 対応設計案

## 目的

Copilot Chat で MCP Shell Server と同等のツール群を VSIX から直接提供できるようにする。MCP サーバー経由のツール提供に依存せず、VS Code の Language Model Tools API を使って同じツール名・入出力・挙動を提供する。

参照:
- [docs/specification.md](docs/specification.md)
- [src/server.ts](src/server.ts)
- https://code.visualstudio.com/api/extension-guides/ai/tools

## 現状

- VSIX は MCP サーバー定義プロバイダのみを提供している。
- Language Model Tools の `contributes.languageModelTools` は未対応。
- ツール実装は MCP サーバー内部で完結しており、拡張機能から直接利用できない。

## ゴール

- Copilot Chat から VSIX 経由で以下のツールを利用可能にする。
- ツール名・入力・出力は MCP Shell Server と同一。
- 既存の安全制約・履歴管理・端末管理の挙動を保持する。

対象ツール一覧:
- shell_execute
- process_get_execution
- shell_set_default_workdir
- list_execution_outputs
- read_execution_output
- delete_execution_outputs
- get_cleanup_suggestions
- perform_auto_cleanup
- terminal_operate
- terminal_list
- terminal_get_info
- terminal_close
- command_history_query

除外:
- adjust_criteria (MCP 側で無効化されているため対象外)

## 設計概要

### 1) VSIX での Language Model Tools 定義

`extensions/vscode-mcp-shell/package.json` に `contributes.languageModelTools` を追加し、MCP ツールと同一の定義を置く。

- `name`: MCP と同名
- `displayName`: UI での表示名
- `modelDescription`: MCP ツールの説明を流用し、利用条件と制約を明示
- `inputSchema`: 既存 Zod スキーマから JSON Schema を生成して流用
- `canBeReferencedInPrompt`: true
- `toolReferenceName`: MCP と同名
- `when`: 必要に応じて制御 (例: 端末系はワークスペースがあるときのみ)

### 2) 拡張側のツール実装

`extensions/vscode-mcp-shell/src/extension.ts` を拡張し、以下の責務を追加する。

- `vscode.lm.registerTool` でツールを登録
- ツール実装は MCP サーバーのコアと同一のクラス構成で動作
- 出力は MCP と同じ JSON 構造を `LanguageModelToolResult` で返す

推奨構成:

- `ToolRuntime` (新規): MCP サーバーの構成要素を拡張内で初期化
  - `ConfigManager`
  - `ProcessManager`
  - `TerminalManager`
  - `FileManager`
  - `MonitoringManager`
  - `SecurityManager`
  - `CommandHistoryManager`
  - `ShellTools`
- `ToolRegistry` (新規): ツール名から対応メソッドへディスパッチ

この構成により MCP サーバーを起動せずに同一のビジネスロジックを使用できる。

### 3) Tool Result 形式

- 結果は MCP のレスポンス JSON と同じ構造を維持する。
- `LanguageModelToolResult` の `LanguageModelTextPart` に JSON 文字列として格納。
- `modelDescription` に「戻り値は JSON 文字列」と明記し、Copilot が安全にパースできるようにする。

例:

```json
{"status":"completed","execution_id":"...","stdout":"..."}
```

### 4) Tool Confirmation

`prepareInvocation` で確認メッセージを返し、ユーザーが意図を理解できる形にする。

対象:
- `shell_execute` (コマンド実行)
- `terminal_operate` (入力送信 / 制御コード)
- `delete_execution_outputs`
- `perform_auto_cleanup`

### 5) Security / Enhanced Evaluator の扱い

MCP サーバーの Enhanced Evaluator は MCP の sampling/elicitation に依存しているため、VSIX 単体では以下の方針を取る。

- 拡張向けに `ChatCompletionAdapter` を新設し、`vscode.lm` 経由で同等の評価を行う。
- `MCP_SHELL_SECURITY_MODE=enhanced` などの強制設定が有効で LM が利用できない場合は Fail Fast でエラーを返す。
- LM が使用できないときは自動的な緩和や安全性の低下は行わない。

この設計により、MCP と同等の安全評価を維持しつつ、VS Code の提供 API に適合できる。

## ツール定義の具体案

`extensions/vscode-mcp-shell/package.json` に以下のような定義を追加する。

- 各ツールの `inputSchema` は `src/types/schemas.ts` と `src/types/quick-schemas.ts` にある Zod から生成
- `modelDescription` は MCP の description を基準にする

例 (shell_execute の抜粋イメージ):

```json
{
  "name": "shell_execute",
  "displayName": "Shell Execute",
  "modelDescription": "Execute shell commands securely with intelligent output handling...",
  "canBeReferencedInPrompt": true,
  "toolReferenceName": "shell_execute",
  "inputSchema": { "type": "object", "properties": { "command": { "type": "string" } }, "required": ["command"] }
}
```

## 実装のステップ案

1. `extensions/vscode-mcp-shell/package.json` に `contributes.languageModelTools` を追加
2. `extensions/vscode-mcp-shell/src/extension.ts` にツール登録処理を追加
3. `ToolRuntime` を新設して MCP サーバーと同じ初期化フローを再現
4. `ShellTools` の各メソッドを呼び出す `LanguageModelTool` 実装を追加
5. `prepareInvocation` と結果 JSON 文字列化を統一
6. Enhanced Evaluator 用の VS Code LM アダプタを追加

## 期待される効果

- MCP サーバーを起動しなくても Copilot Chat から同一ツールを利用可能
- VSIX だけで配布可能なため導入・更新が簡素化
- MCP と VSIX の両方で同一の挙動・仕様を維持

## 未決事項

- `vscode.lm` の利用可否と利用モデルの選定
- Enhanced Evaluator を VS Code LM に移植する際の最小必要プロンプトとツール設計
- ツールの戻り値 JSON のスキーマ共有方法 (型生成 or 手書き)
