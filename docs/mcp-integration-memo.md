# MCP統合機能に関する技術メモ

## MCPプロトコルの基本概念

### MCP (Model Context Protocol)
- LLMとツール間の標準的な通信プロトコル
- JSON-RPC 2.0ベースのメッセージング
- 双方向通信によるリアルタイム対話

### Elicitation機能
- **目的**: ユーザ意図の明確化・確認
- **実装**: `mcp-confirm`サーバーの参考実装
- **動作**: MCPクライアント→ユーザへの確認要求
- **特徴**: ユーザ意図が絶対的な優先度を持つ

### Sampler機能
- **目的**: LLMによる高度なコマンド安全性評価
- **実装**: `mcp-llm-generator`サーバーの参考実装
- **動作**: 構造化プロンプトによるLLM評価
- **特徴**: 文脈的危険性判定と改善提案

## 現在の要求仕様における位置づけ

### 1. Elicitation統合
```typescript
interface ElicitationManager {
  // ユーザ意図確認（ユーザ意図が絶対）
  async elicitUserIntent(
    command: string,
    uncertainty_areas: string[]
  ): Promise<ElicitationResult>;
  
  // 最終ユーザ確認（危険コマンド実行前）
  async requestFinalUserConfirmation(
    command: string,
    safety_evaluation: LLMEvaluationResult
  ): Promise<UserConfirmationResult>;
}
```

### 2. Sampler統合
```typescript
interface LLMSampler {
  evaluateCommandSafety(
    command: string,
    context: EvaluationContext,
    previousDenial?: string,
    resubmissionContext?: ResubmissionContext
  ): Promise<LLMEvaluationResult>;
}
```

### 3. 統合評価フロー
```
[基本安全分類] 
    ↓
[User Elicitation] (必要時)
    ↓
[LLM Sampler評価] 
    ↓
[再審査プロセス] (CONDITIONAL_DENY時)
    ↓
[Final User Confirmation] (危険コマンド時)
    ↓
[実行]
```

## 実装上の考慮事項

### 内蔵 vs 外部MCP
- **内蔵実装**: 依存性削減、性能向上、運用シンプル化
- **外部MCP**: 標準準拠、拡張性、分離設計

### ユーザ確認履歴の活用
- 過去の確認パターンから意図推測
- 学習による確認頻度最適化
- プライバシー配慮の履歴管理

### 再審査メカニズム
- 条件付き否認→改善→再評価サイクル
- 直前コマンド履歴の文脈追加
- 学習による精度向上

---

## 技術的課題と解決方針

### 1. 性能要件
- Elicitation: 60秒以内
- Sampler: 3秒以内
- 全体遅延: 既存機能+5%以下

### 2. 可用性要件
- 外部依存失敗時のフォールバック
- 段階的機能無効化
- 既存機能への影響ゼロ

### 3. 学習・改善
- 否認→改善→許可パターンの学習
- ユーザ確認履歴による意図推測
- 運用データ分析による継続改善

---

## 実装推奨順序

### Phase 1: 基盤
1. コマンド履歴管理（ユーザ確認履歴含む）
2. 基本安全分類
3. 内蔵Elicitation

### Phase 2: 高度評価
1. 内蔵Sampler
2. 再審査システム
3. 学習機能

### Phase 3: 運用機能
1. 監査・レポート
2. 性能最適化
3. 外部MCP対応（オプション）
