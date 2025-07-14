# MCP Shell Server 改善実施チェックリスト

## 概要
このチェックリストは、MCP Shell Serverのツール名とExecutionModeの改善を段階的に実施するためのものです。

## Phase 1: ExecutionModeと応答パラメータの改善 [優先度: 高]

### ExecutionMode の実装変更
- [ ] `src/types/index.ts` - ExecutionModeスキーマを更新
  - [ ] `'sync' | 'async' | 'background'` → `'foreground' | 'background' | 'detached' | 'adaptive'`
  - [ ] デフォルト値を`'adaptive'`に変更
- [ ] `src/types/schemas.ts` - パラメータスキーマの更新
  - [ ] `foreground_timeout_seconds`パラメータの追加
  - [ ] `return_partial_on_timeout`パラメータの追加
- [ ] `src/core/process-manager.ts` - 実行ロジックの実装
  - [ ] `adaptive`モードの実装
  - [ ] `foreground`モードの実装（現在のsyncから改名）
  - [ ] タイムアウト時の部分出力応答機能
- [ ] `src/tools/shell-tools.ts` - ツール層の更新
  - [ ] 新しいExecutionModeパラメータの対応

### 応答パラメータの改善
- [ ] `file`から`output`への用語統一
  - [ ] `output_file_id` → `output_id`
  - [ ] `file_id` → `output_id`
  - [ ] `file_ids` → `output_ids`
  - [ ] `file_type` → `output_type`
- [ ] 応答フィールドの追加
  - [ ] `output_id`フィールドの実装
  - [ ] `output_truncated`フィールドの確認

### テスト
- [ ] ExecutionModeの単体テスト
  - [ ] `foreground`モードのテスト
  - [ ] `background`モードのテスト  
  - [ ] `detached`モードのテスト
  - [ ] `adaptive`モードのテスト
- [ ] タイムアウト応答のテスト
  - [ ] 部分出力応答のテスト
  - [ ] `output_id`生成のテスト

## Phase 2: ツール名変更とワーキングディレクトリ [優先度: 中]

### ツール名の変更実装
- [ ] `src/server.ts` - ツール定義の更新
  - [ ] `shell_get_execution` → `process_get_execution`
  - [ ] `process_kill` → `process_terminate`
  - [ ] `terminal_get` → `terminal_get_info`
  - [ ] `terminal_input` → `terminal_send_input`
  - [ ] `terminal_output` → `terminal_get_output`
  - [ ] `file_list` → `list_execution_outputs`
  - [ ] `file_read` → `read_execution_output`
  - [ ] `file_delete` → `delete_execution_outputs`
- [ ] `src/types/schemas.ts` - スキーマ名の更新
- [ ] `src/tools/shell-tools.ts` - メソッド名の更新（必要に応じて）

### ワーキングディレクトリ管理の改善
- [ ] 環境変数サポートの実装
  - [ ] `MCP_SHELL_DEFAULT_WORKDIR`の処理
  - [ ] `MCP_SHELL_ALLOWED_WORKDIRS`の処理
- [ ] 新ツール`shell_set_default_workdir`の実装
  - [ ] ツール定義の追加
  - [ ] 実装ロジックの追加
- [ ] 既存のworking_directory変更バグの修正
- [ ] 応答フィールドの改善
  - [ ] `working_directory`
  - [ ] `default_working_directory` 
  - [ ] `working_directory_changed`

### テスト
- [ ] 新ツール名でのテスト更新
- [ ] ワーキングディレクトリ機能のテスト
- [ ] 環境変数設定のテスト

## Phase 3: セキュリティ設定の簡素化 [優先度: 低]

### セキュリティモードの実装
- [ ] `SecurityMode`型の追加
- [ ] セキュリティプリセットの実装
- [ ] 既存設定からの移行ロジック

### テスト
- [ ] セキュリティモードのテスト
- [ ] プリセット機能のテスト

## ドキュメント更新

- [x] 改善提案ドキュメントの作成
- [ ] `README.md`の更新
- [ ] APIドキュメントの更新
- [ ] 使用例の更新
- [ ] CHANGELOGの更新

## 後方互換性

- [ ] 既存ツール名の非推奨警告実装
- [ ] 移行ガイドの作成
- [ ] バージョンアップ計画の策定

## 実装順序

1. **Phase 1**: ExecutionMode + 応答パラメータ（破壊的変更なし）
2. **Phase 2**: ツール名変更（破壊的変更あり、バージョンアップ必要）
3. **Phase 3**: セキュリティ簡素化（管理者向け、影響限定的）

## 注意事項

- Phase 2は破壊的変更を含むため、メジャーバージョンアップが必要
- 各Phaseは独立して実装・テスト可能
- 実装前に必ずテストを作成すること
- ドキュメントは実装と同時に更新すること

## 完了基準

- [ ] すべてのテストがパス
- [ ] ドキュメントが更新済み
- [ ] 後方互換性が確保されている（Phase 1）
- [ ] 移行ガイドが完成している（Phase 2以降）
