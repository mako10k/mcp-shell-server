# MCP Shell Server 改善実施チェックリスト

## 概要
このチェックリストは、MCP Shell Serverのツール名とExecutionModeの改善を段階的に実施するためのものです。

**注意**: 後方互換性は不要です。LLMは新しいツール定義に柔軟に対応できます。

## Phase 1: ExecutionModeと応答パラメータの改善 [優先度: 高]

### ExecutionMode の実装変更
- [x] `src/types/index.ts` - ExecutionModeスキーマを更新
  - [x] `'sync' | 'async' | 'background'` → `'foreground' | 'background' | 'detached' | 'adaptive'`
  - [x] デフォルト値を`'adaptive'`に変更
- [x] `src/types/schemas.ts` - パラメータスキーマの更新
  - [x] `foreground_timeout_seconds`パラメータの追加
  - [x] `return_partial_on_timeout`パラメータの追加
- [x] `src/core/process-manager.ts` - 実行ロジックの実装
  - [x] `adaptive`モードの実装
  - [x] `foreground`モードの実装（現在のsyncから改名）
  - [x] タイムアウト時の部分出力応答機能
- [x] `src/tools/shell-tools.ts` - ツール層の更新
  - [x] 新しいExecutionModeパラメータの対応

### 応答パラメータの改善
- [x] `file`から`output`への用語統一
  - [x] `output_file_id` → `output_id`
  - [x] `file_id` → `output_id`
  - [x] `file_ids` → `output_ids`
  - [x] `file_type` → `output_type`
- [x] 応答フィールドの追加
  - [x] `output_id`フィールドの実装
  - [x] `output_truncated`フィールドの確認

### テスト
- [x] ExecutionModeの単体テスト
  - [x] `foreground`モードのテスト
  - [x] `background`モードのテスト  
  - [x] `detached`モードのテスト
  - [x] `adaptive`モードのテスト
- [x] タイムアウト応答のテスト
  - [x] 部分出力応答のテスト
  - [x] `output_id`生成のテスト

## Phase 2: ツール名変更とワーキングディレクトリ [優先度: 中]

### ツール名の変更実装
- [x] `src/server.ts` - ツール定義の更新
  - [x] `shell_get_execution` → `process_get_execution`
  - [x] `process_kill` → `process_terminate`
  - [x] `terminal_get` → `terminal_get_info`
  - [x] `terminal_input` → `terminal_send_input`
  - [x] `terminal_output` → `terminal_get_output`
  - [x] `file_list` → `list_execution_outputs`
  - [x] `file_read` → `read_execution_output`
  - [x] `file_delete` → `delete_execution_outputs`
- [x] `src/types/schemas.ts` - スキーマ名の更新
- [x] `src/tools/shell-tools.ts` - メソッド名の更新（必要に応じて）

### ワーキングディレクトリ管理の改善
- [x] 環境変数サポートの実装
  - [x] `MCP_SHELL_DEFAULT_WORKDIR`の処理
  - [x] `MCP_SHELL_ALLOWED_WORKDIRS`の処理
- [x] 新ツール`shell_set_default_workdir`の実装
  - [x] ツール定義の追加
  - [x] 実装ロジックの追加
- [x] 既存のworking_directory変更バグの修正
- [x] 応答フィールドの改善
  - [x] `working_directory`
  - [x] `default_working_directory` 
  - [x] `working_directory_changed`

### テスト
- [x] 新ツール名でのテスト更新
- [x] ワーキングディレクトリ機能のテスト
- [x] 環境変数設定のテスト

## 発見された課題とタスク

- [x] FileManagerとProcessManagerの連携問題修正【重要】 ✅ **完了**
  - [x] 問題分析完了: ProcessManagerが独自のoutputFiles管理でFileManagerと非連携
  - [x] ProcessManagerの`saveOutputToFile`をFileManager連携に変更
  - [x] ProcessManagerにFileManager依存性注入またはファクトリパターン実装
  - [x] `list_execution_outputs`ツールの実装をProcessManager.outputFiles → FileManager.listFiles に変更
  - [x] `read_execution_output`ツールの実装をProcessManager → FileManager に変更
  - [x] 既存出力ファイルのマイグレーション対応
  - [x] テストケースの追加・修正

## Phase 3: セキュリティ設定の簡素化 [優先度: 低] ✅ **完了**

### セキュリティモードの改善
- [x] `SecurityMode`型の追加（permissive/restrictive/custom）
- [x] SecurityManagerの基本実装完了
- [x] セキュリティプリセットの詳細化
  - [x] permissiveモード: 危険パターンのみブロック
  - [x] restrictiveモード: 読み取り専用コマンドのみ許可
  - [x] customモード: 詳細設定による制御
- [x] `security_set_restrictions`ツールのスキーマ改善
  - [x] SecurityModeに基づくパラメータ最適化
  - [x] プリセット選択の簡素化
- [x] デフォルト設定の最適化
  - [x] 環境変数による初期設定サポート
  - [x] 安全なデフォルト値の確定

### テスト
- [x] セキュリティモードのテスト
  - [x] permissiveモードのテスト
  - [x] restrictiveモードのテスト
  - [x] customモードのテスト
- [x] プリセット機能のテスト
- [x] 危険パターン検出のテスト
- [x] セキュリティ設定ツールのテスト

## 次のステップ - 優先課題

1. **FileManagerとProcessManagerの連携問題修正【最優先】**
   - ProcessManagerが独自のoutputFiles管理でFileManagerと非連携
   - `list_execution_outputs`と`read_execution_output`ツールが正常に動作しない
   - 統一された出力ファイル管理システムが必要

2. **ドキュメント更新**
   - README.mdの更新（新ツール名、新機能の説明）
   - API仕様書の更新
   - CHANGELOGの作成

## 完了したPhase

- ✅ **Phase 1**: ExecutionModeと応答パラメータの改善
- ✅ **Phase 2**: ツール名変更とワーキングディレクトリ
- ✅ **Phase 3**: セキュリティ設定の簡素化
- [ ] 使用例の更新
- [ ] CHANGELOGの更新

## 実装順序

1. **Phase 1**: ExecutionMode + 応答パラメータ（LLMの使いやすさ重視）
2. **Phase 2**: ツール名変更（一貫性向上）
3. **Phase 3**: セキュリティ簡素化（管理者体験向上）

## 注意事項

- 後方互換性は考慮しない（LLMは新しい定義に自動適応）
- 各Phaseは独立して実装・テスト可能
- 実装前に必ずテストを作成すること
- ドキュメントは実装と同時に更新すること

## 完了基準

- [ ] すべてのテストがパス
- [ ] ドキュメントが更新済み
- [ ] 新しいツール定義でLLMが正常に動作
