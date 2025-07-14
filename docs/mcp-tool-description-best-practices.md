# MCP Tool Description Best Practices

## Overview

このドキュメントは、Model Context Protocol (MCP) ツールの description とパラメータ description のベストプラクティスをまとめたものです。LLM が誤解しにくく、効果的にツールを使用できるような記述方法を目指します。

## Research Findings

### 調査した情報源

1. **Anthropic - Building Effective AI Agents (2024年12月)**
   - "A good tool definition often includes example usage, edge cases, input format requirements"
   - LLM が理解しやすいツール定義の重要性を強調

2. **MCP Security Guidelines (Collabnix, 2025年5月)**
   - "Tool Description Poisoning" のリスク
   - AI モデルが description を信頼してツール使用を判断するため、正確で誤解を招かない記述が重要

3. **MCP Official Specification (2025年6月)**
   - JSON Schema ベースの標準的なフォーマット
   - パラメータの型、制約、デフォルト値の明確な定義が必要

## Best Practices

### 1. Tool Description

#### ✅ Good Practices
- **明確で具体的**: 何を行うツールかを1文で明確に説明
- **実行結果の説明**: ツールの実行により何が起こるかを含める
- **制約の明記**: セキュリティ制限やサンドボックス環境などの重要な制約を記載
- **使用場面の提示**: どのような場面で使用すべきかのガイダンス

#### ❌ Avoid
- 曖昧な表現（"handle", "manage", "process"など）
- 技術的すぎる内部実装の詳細
- 過度に長い説明文

#### Example Improvements

**Before (current):**
```
"Execute shell commands securely in a sandboxed environment. Can also create new interactive terminal sessions."
```

**After (improved):**
```
"Execute shell commands in a secure sandboxed environment and return their output. Supports multiple execution modes: foreground (immediate), background (async), and adaptive (starts foreground, switches to background if needed). Commands run with security restrictions and resource limits."
```

### 2. Parameter Description

#### ✅ Good Practices
- **目的の明記**: パラメータが何のために使用されるかを説明
- **値の範囲・制約**: 許可される値の範囲やフォーマットを明確化
- **デフォルト値の説明**: デフォルト値がある場合はその理由も説明
- **相互関係の説明**: 他のパラメータとの関係性があれば明記
- **具体例の提供**: 可能な場合は使用例を含める

#### ❌ Avoid
- パラメータ名の単純な繰り返し
- 型情報のみの記載
- 曖昧な修飾語（"appropriate", "suitable"など）

#### Example Improvements

**Before (current):**
```
command: "Command to execute"
execution_mode: "Execution mode"
timeout_seconds: "Timeout in seconds for foreground mode"
```

**After (improved):**
```
command: "Shell command to execute (e.g., 'ls -la', 'npm install', 'python script.py'). Command will be validated against security restrictions."
execution_mode: "How the command should be executed: 'foreground' (wait for completion), 'background' (run async), 'detached' (fire-and-forget), 'adaptive' (start foreground, switch to background for long-running commands)"
timeout_seconds: "Maximum time in seconds to wait for foreground execution before switching to background or failing. Range: 1-3600 seconds."
```

### 3. Error and Edge Cases

#### ✅ Include in descriptions:
- セキュリティ制限による実行失敗の可能性
- タイムアウト時の動作
- リソース制限（メモリ、出力サイズ）
- パーミッション要件

#### Example:
```
"Note: Commands may be blocked by security restrictions. Long-running commands will automatically switch to background execution after the foreground timeout."
```

### 4. Consistency Guidelines

#### Naming Conventions
- 動詞で始める（execute, list, get, set, delete など）
- 階層的な命名（process_list, terminal_create など）
- 明確で省略しない用語の使用

#### Language Style
- 現在形の能動態を使用
- 簡潔で直接的な表現
- 技術的だが理解しやすい用語選択

## Current MCP Shell Server Analysis

### Issues Identified

1. **Tool Descriptions Too Brief**
   - 現在の description は簡潔すぎて、実行結果や制約が不明確
   - セキュリティ制限や実行環境の詳細が不足

2. **Parameter Descriptions Lack Context**
   - パラメータ名の繰り返しに近い説明が多い
   - 値の範囲や相互関係の説明が不足
   - 具体的な使用例がない

3. **Inconsistent Detail Level**
   - 一部のパラメータは詳細、一部は簡潔すぎる
   - 重要度に応じた説明の濃淡が不適切

4. **Missing Edge Case Information**
   - エラーケースやセキュリティ制限の説明が不足
   - タイムアウトやリソース制限の動作が不明確

## Improvement Plan

### Phase 1: Core Tool Descriptions (Priority: High) ✅ **完了**
- [x] `shell_execute` - 最も重要なツールの description 改善
- [x] `process_list` - プロセス管理系ツールの統一的な description  
- [x] `terminal_create` - ターミナル管理系ツールの説明強化
- [x] **全18ツール** - すべてのツール description を詳細化

### Phase 2: Parameter Descriptions (Priority: High) ✅ **完了**
- [x] 実行モード関連パラメータの詳細化
- [x] セキュリティ・制限関連パラメータの説明強化
- [x] 出力・ファイル関連パラメータの明確化
- [x] **全パラメータ** - 具体例・制約・相互関係を明記

### Phase 3: Consistency Review (Priority: Medium) ✅ **完了**
- [x] 全ツール間での用語統一
- [x] description のトーン・文体統一
- [x] パラメータ説明の詳細レベル調整

### Phase 4: Documentation Integration (Priority: Low)
- [ ] README への反映
- [ ] API 仕様書の更新
- [ ] 使用例の追加

## Implementation Notes

- Zod schema の `.describe()` メソッドで改善された description を適用
- JSON Schema 生成時に description が適切に含まれることを確認
- 既存のテストケースに影響しないことを検証
- description 変更による MCP クライアントへの影響を最小化

## Bug Fixes During Implementation

### Critical: `return_partial_on_timeout` Bug ✅ **修正完了**
- **問題**: `return_partial_on_timeout: true` が設定されていてもタイムアウト時にエラーが返されていた
- **原因**: ProcessManager でタイムアウト処理時に `returnPartialOnTimeout` オプションが考慮されていなかった
- **修正**: タイムアウト時に部分結果を返すロジックを実装
- **結果**: タイムアウト時に `status: "timeout"` と部分出力が正しく返される

## References

1. [Anthropic - Building Effective AI Agents](https://www.anthropic.com/research/building-effective-agents)
2. [Securing the Model Context Protocol: A Comprehensive Guide](https://collabnix.com/securing-the-model-context-protocol-a-comprehensive-guide/)
3. [Model Context Protocol Specification](https://modelcontextprotocol.io/specification/2025-06-18)
4. [Guide to Tool Calling in LLMs](https://www.analyticsvidhya.com/blog/2024/08/tool-calling-in-llms/)

## Consistency Review (Phase 4c) ✅ **完了**

### Consistency Checks Applied

1. **用語統一**
   - "command execution" で統一（"command executions" など複数形の不統一を修正）
   - "output files" で統一（"execution outputs" との混在を解消）
   - "session" vs "sessions" の適切な使い分け

2. **トーン・文体統一**
   - 説明形で統一（"Execute...", "List...", "Retrieve..." など）
   - 命令形（"Use", "Supports"）から説明文への調整
   - 技術的詳細レベルの統一

3. **詳細レベル調整**
   - 冗長な説明を簡潔に調整
   - 重要な制約・機能は維持
   - LLM が理解しやすい適切な情報量に統一

### Tools Adjusted for Consistency

- `shell_execute`: 冗長な詳細を簡潔化
- `terminal_*` ツール群: 説明レベルを統一、簡潔性を重視
- 全ツール: 用語統一とトーン調整

### Result

- 全18ツールの description が一貫性を保ちつつ明確
- LLM が混乱しにくい統一された説明スタイル
- 適切な詳細レベルでの情報提供
