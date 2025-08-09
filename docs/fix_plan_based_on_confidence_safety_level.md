# 修正計画: Confidence と Safety Level に基づく改善

## 概要
本修正計画は、`confidence` と `safety_level` に関する議論および結論に基づき、システムの設計と実装を改善するための具体的な手順を示します。

## 修正の目的
1. **Fail Fast 原則の徹底**:
   - エラーや不確実性が発生した場合に即座に処理を停止し、安全側に倒す設計を採用する。

2. **LLM を主役とした評価ロジックの確立**:
   - LLM を安全性評価の主役（main evaluator）として位置付け、初期フィルタは補助的な役割に限定する。

3. **フォールバックロジックの廃止**:
   - 曖昧な値を設定するフォールバックを廃止し、明確なエラーを返す。

4. **初期フィルタのデフォルトOFF設定**:
   - 初期フィルタはデフォルトで無効化し、`enhanced-fast` モード時のみ有効化する。

## 修正手順

### 1. `confidence` の削除
- **対象ファイル**:
  - `src/security/common-llm-evaluator.ts`
  - `src/security/enhanced-evaluator.ts`
  - `src/security/structured-output-schemas.ts`
- **修正内容**:
  - `confidence` に関連するすべてのロジックを削除。
  - フォールバック時に設定されていた固定値（例: `confidence: 0.3`）を廃止。

### 2. `safety_level` の再定義
- **対象ファイル**:
  - `src/security/structured-output-schemas.ts`
  - `src/security/manager.ts`
- **修正内容**:
  - `safety_level` を初期フィルタの結果としてのみ使用。
  - LLM のプロンプト生成やエラーハンドリングには影響を与えないように変更。

### 3. 初期フィルタのデフォルトOFF設定
- **対象ファイル**:
  - `src/security/manager.ts`
- **修正内容**:
  - 初期フィルタをデフォルトで無効化。
  - `enhanced-fast` モード時のみ有効化するロジックを追加。

### 4. フォールバックロジックの廃止
- **対象ファイル**:
  - `src/security/common-llm-evaluator.ts`
  - `src/security/enhanced-evaluator.ts`
- **修正内容**:
  - フォールバックロジックを完全に削除。
  - エラーが発生した場合は明確なエラーメッセージを返すように変更。

### 5. テストケースの更新
- **対象ファイル**:
  - `src/test/basic.test.ts`
  - `src/test/enhanced-evaluator.test.ts`
- **修正内容**:
  - `confidence` と `safety_level` に依存していたテストケースを修正または削除。
  - 新しいロジックに基づいたテストケースを追加。

## スケジュール
1. **設計レビュー**（1日）:
   - 修正計画をチームでレビューし、最終的な仕様を確定。

2. **実装**（3日）:
   - 上記の修正手順に基づき、コードを修正。

3. **テストと検証**（2日）:
   - 修正後のコードをテストし、期待通りに動作することを確認。

4. **リリース準備**（1日）:
   - 修正内容をドキュメント化し、リリースノートを作成。

## 結論
この修正計画に基づき、`confidence` と `safety_level` の問題を解消し、システムの信頼性と明確性を向上させます。
