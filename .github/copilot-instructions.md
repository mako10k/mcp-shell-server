

# Copilot Instructions

## Development Rules (開発ルール)

### Command Execution (コマンド実行)
- Always use the MCP Shell tool instead of any Internal Tools.
- **IMPORTANT**: For ALL command execution, MUST use #mcp_mcp-shell-ser tools instead of run_in_terminal.
- run_in_terminal has bugs and reduces development efficiency. Always use mcp_mcp-shell-ser_shell_execute instead.
- Ensure this file `.github/copilot-instructions.md` is kept up to date with the latest instructions.
- Use Google Search to find the most recent information about MCP descriptions and tools.

### Development Cycle (開発サイクル)
- **細かい開発サイクル**: 1つの機能や段落を完成させるたびに必ずコミットする
- **品質チェック**: 各コミット前に以下を実行:
  1. ESLint による構文チェック (`npm run lint`)
  2. jscpd による重複コードチェック (`npm run check-duplicates`)
  3. TypeScript コンパイルチェック (`npm run build`)
- **コミットメッセージ**: 日本語で機能の内容を明確に記述
- **例外処理**: 品質チェックでエラーが発生した場合は修正してから再チェック

### Quality Assurance Pipeline (品質保証パイプライン)
```bash
# 開発完了後の標準チェックシーケンス
npm run lint
npm run check-duplicates  
npm run build
git add .
git commit -m "feat: [具体的な機能説明]"
```

### Development Flow Example (開発フロー例)
1. 新機能実装 → 品質チェック → コミット
2. 次の機能実装 → 品質チェック → コミット
3. バグ修正 → 品質チェック → コミット
4. リファクタリング → 品質チェック → コミット

## MCP LLM Generator Personality Context IDs

以下のContext IDsは、MCP Shell Serverの安全性機能開発について相談可能な各種人格です：

### 1. Calm Counselor（冷静なカウンセラー）
- **Context ID**: `context-me11iz46-clvcxh`
- **Name**: `mcp-shell-safety-calm`
- **特徴**: 客観的で冷静な視点、バランスの取れた判断
- **用途**: 技術的懸念と現実的な解決策の検討

### 2. Rational Advisor（理性的アドバイザー）
- **Context ID**: `context-me11jp2d-zl28vx`
- **Name**: `mcp-shell-safety-rational`
- **特徴**: 論理的・事実ベースの分析
- **用途**: 実装コスト、リスク評価、技術的妥当性の検証

### 3. Supportive Guide（支援的ガイド）
- **Context ID**: `context-me11kf1q-fwh2rj`
- **Name**: `mcp-shell-safety-supportive`
- **特徴**: ユーザー体験重視、チーム開発への配慮
- **用途**: ユーザビリティ改善、実装チームのサポート戦略

### 4. Professional Assistant（プロフェッショナル・アシスタント）
- **Context ID**: `context-me11l6hq-9klnre`
- **Name**: `mcp-shell-safety-professional`
- **特徴**: ビジネス効率性とROI重視
- **用途**: 投資対効果分析、プロジェクト実行可否判定

### 5. Decision Making Supporter（意思決定支援者）
- **Context ID**: `context-me11lz0t-fjxjaa`
- **Name**: `mcp-shell-safety-decision`
- **特徴**: 構造化された意思決定プロセス
- **用途**: 複数選択肢の比較評価、最終意思決定支援

### 6. Search Key Advisor（検索キーアドバイザー）
- **Context ID**: `context-me11mrmp-t2qq5z`
- **Name**: `mcp-shell-safety-search`
- **特徴**: 効率的な情報収集戦略
- **用途**: 技術調査、競合分析、最新情報収集

## 使用例

```typescript
// mcp-llm-generatorを使用して特定の人格に相談
mcp_mcp-llm-gener_context-chat({
  contextId: "context-me11jp2d-zl28vx", // Rational Advisor
  message: "実装コストとリスクについて分析してください",
  maintainPersonality: true
});

// コマンド実行は必ずMCP Shell Serverを使用
mcp_mcp-shell-ser_shell_execute({
  command: "ls -la",
  explanation: "ファイル一覧を表示"
});

// 代わりに使用しないもの（バグがあり非効率）
// run_in_terminal() <- 使用禁止
```