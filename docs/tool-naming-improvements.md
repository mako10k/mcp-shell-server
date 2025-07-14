# MCP Shell Server ツール名改善提案

## 概要

このドキュメントは、MCP Shell Serverのツール名をLLMにとってより理解しやすくするための改善提案をまとめています。

## 改善が必要な理由

現在のツール名には以下の問題があります：

1. **動詞の省略**: 一部のツールで動作の方向性（送信 vs 取得）が不明確
2. **カテゴリの不一致**: 機能とカテゴリ接頭辞が一致していない
3. **曖昧な動詞**: より適切な技術用語に置き換え可能
4. **OSファイル操作との混同**: `file_*`ツールがOSの一般的なファイル操作（`ls`, `cat`, `rm`）と誤解されやすい

## ツール名変更案

| 現在のツール名 | 改善案 | 変更理由 |
|---------------|--------|----------|
| `shell_get_execution` | `process_get_execution` | 実際の機能はプロセス実行情報の取得であり、カテゴリを統一 |
| `process_kill` | `process_terminate` | "terminate"は技術的により適切で攻撃的でない表現 |
| `terminal_get` | `terminal_get_info` | 何を取得するのかを明確化 |
| `terminal_input` | `terminal_send_input` | 動作の方向性（送信）を明示 |
| `terminal_output` | `terminal_get_output` | 動作の方向性（取得）を明示 |
| `file_list` | `list_execution_outputs` | OSファイル操作との混同を防ぎ、実行結果の出力ファイルであることを明確化 |
| `file_read` | `read_execution_output` | OSファイル操作との混同を防ぎ、実行結果の出力読み取りであることを明確化 |
| `file_delete` | `delete_execution_outputs` | OSファイル操作との混同を防ぎ、実行結果の出力削除であることを明確化 |

## 完全なツール一覧（改善版）

### Shell操作
| ツール名 | 機能 | 主要パラメータ |
|----------|------|----------------|
| `shell_execute` | シェルコマンドの実行またはターミナルセッション作成 | `command` (必須), `execution_mode` (デフォルト: `'adaptive'`), `working_directory`, `foreground_timeout_seconds`, `create_terminal` |

### プロセス管理
| ツール名 | 機能 | 主要パラメータ |
|----------|------|----------------|
| `process_get_execution` | プロセス実行情報の取得 | `execution_id` (必須) |
| `process_list` | プロセス一覧の取得 | `status_filter`, `command_pattern`, `session_id`, `limit`, `offset` |
| `process_terminate` | プロセスの終了 | `process_id` (必須), `signal`, `force` |
| `process_monitor` | プロセス監視の開始 | `process_id` (必須), `monitor_interval_ms`, `include_metrics` |

### 実行出力管理
| ツール名 | 機能 | 主要パラメータ |
|----------|------|----------------|
| `list_execution_outputs` | 実行結果として生成された出力の一覧取得 | `output_type`, `execution_id`, `name_pattern`, `limit` |
| `read_execution_output` | 実行結果の出力内容の読み取り | `output_id` (必須), `offset`, `size`, `encoding` |
| `delete_execution_outputs` | 実行結果の出力の削除 | `output_ids` (必須), `confirm` (必須) |

### ターミナル管理
| ツール名 | 機能 | 主要パラメータ |
|----------|------|----------------|
| `terminal_create` | ターミナルセッションの作成 | `session_name`, `shell_type`, `dimensions`, `working_directory`, `environment_variables`, `auto_save_history` |
| `terminal_list` | ターミナル一覧の取得 | `session_name_pattern`, `status_filter`, `limit` |
| `terminal_get_info` | ターミナル詳細情報の取得 | `terminal_id` (必須) |
| `terminal_send_input` | ターミナルへの入力送信 | `terminal_id` (必須), `input` (必須), `execute`, `control_codes`, `raw_bytes`, `send_to` |
| `terminal_get_output` | ターミナル出力の取得 | `terminal_id` (必須), `start_line`, `line_count`, `include_ansi`, `include_foreground_process` |
| `terminal_resize` | ターミナルのリサイズ | `terminal_id` (必須), `dimensions` (必須) |
| `terminal_close` | ターミナルセッションの終了 | `terminal_id` (必須), `save_history` |

### セキュリティ・監視
| ツール名 | 機能 | 主要パラメータ |
|----------|------|----------------|
| `security_set_restrictions` | セキュリティ制限の設定 | `allowed_commands`, `blocked_commands`, `allowed_directories`, `max_execution_time`, `max_memory_mb`, `enable_network` |
| `monitoring_get_stats` | システム統計情報の取得 | `include_metrics`, `time_range_minutes` |

## ExecutionMode 改善提案

現在の`ExecutionMode`をより直感的で実用的なものに改善します：

### 新しい ExecutionMode

- **ExecutionMode**: `'foreground' | 'background' | 'detached' | 'adaptive'` (デフォルト: `'adaptive'`)

| モード | 説明 | 使用場面 | 新規パラメータ |
|--------|------|----------|----------------|
| `foreground` | 完了まで待機、結果を即座に返す | 短時間コマンド、即座に結果が必要 | `timeout_seconds` |
| `background` | 即座に制御を返し、独立実行 | 長時間サービス、デーモン起動 | - |
| `detached` | 完全に独立、親プロセス終了後も継続 | システムサービス、永続プロセス | - |
| `adaptive` | 指定時間待機後、自動的にbackgroundに移行 | **実行時間が不明な処理（推奨デフォルト）** | `foreground_timeout_seconds` |

### タイムアウト応答の改善

**foregroundモードでのタイムアウト時**:
- **現在**: タイムアウトエラーを返す
- **改善後**: `success: false`でタイムアウト時点までの部分的な応答を返す

```json
{
  "success": false,
  "status": "timeout",
  "execution_time_ms": 30000,
  "stdout": "処理中の部分的な出力...",
  "stderr": "部分的なエラー出力...",
  "message": "Command timed out after 30 seconds",
  "partial_output": true
}
```

### 新しいパラメータ体系

```typescript
{
  execution_mode: 'foreground' | 'background' | 'detached' | 'adaptive', // デフォルト: 'adaptive'
  
  // foreground/adaptiveモード用
  timeout_seconds?: number,              // foregroundでの最大待機時間 (デフォルト: 30)
  foreground_timeout_seconds?: number,   // adaptiveモードでforegroundで待機する時間 (デフォルト: 10)
  
  // 共通
  max_output_size?: number,
  capture_stderr?: boolean,
  return_partial_on_timeout?: boolean    // タイムアウト時に部分出力を返すか (デフォルト: true)
}
```

## パラメータの詳細説明

### 共通パラメータ型

- **ExecutionMode**: `'foreground' | 'background' | 'detached' | 'adaptive'` (デフォルト: `'adaptive'`)
- **ShellType**: `'bash' | 'zsh' | 'fish' | 'cmd' | 'powershell'`
- **ProcessSignal**: `'TERM' | 'KILL' | 'INT' | 'HUP' | 'USR1' | 'USR2'`
- **OutputType**: `'stdout' | 'stderr' | 'combined' | 'log' | 'all'`
- **Dimensions**: `{ width: number, height: number }`
- **EnvironmentVariables**: `Record<string, string>`

### 重要な制限事項

- `timeout_seconds`: 1-3600秒 (foregroundモード)
- `foreground_timeout_seconds`: 1-300秒 (adaptiveモード、デフォルト: 10秒)
- `max_output_size`: 1KB-100MB
- `max_execution_time`: 1-86400秒
- `max_memory_mb`: 1-32768MB
- `monitor_interval_ms`: 100-60000ミリ秒
- `line_count`: 1-10000行
- `limit`: ツールによって異なる（50-1000）

### 使用例とベストプラクティス

```typescript
// 短時間で確実に終わるコマンド
{ execution_mode: 'foreground', timeout_seconds: 30 }

// 実行時間不明のコマンド（推奨デフォルト）
{ execution_mode: 'adaptive', foreground_timeout_seconds: 15 }

// 長時間サービス
{ execution_mode: 'background' }

// システムサービス
{ execution_mode: 'detached' }
```

## 実装への影響

この変更により以下の利点が期待されます：

1. **LLMの理解向上**: 動作の方向性が明確になることで、適切なツール選択が可能
2. **一貫性の向上**: カテゴリと機能の整合性により、関連ツールのグループ化が容易
3. **保守性の向上**: より直感的な命名により、開発者の理解も向上
4. **デフォルトの最適化**: `adaptive`モードにより、LLMが実行時間を予測できない場合の処理が改善
5. **タイムアウト処理の改善**: 部分的な出力の取得により、LLMの混乱を防止

### 特に重要な改善点

- **`adaptive`モードがデフォルト**: LLMが実行時間を予測困難な場合に最適
- **部分的な出力の取得**: タイムアウト時でも有用な情報をLLMに提供
- **成功/失敗の明確化**: `success`フラグにより結果の判定が容易

## 追加の改善提案

### 1. 応答パラメータ名の改善

**問題**: 出力が切り詰められた場合、LLMがどのツールで完全な内容を取得できるかが不明確

**改善案**:
```json
{
  "success": true,
  "stdout": "部分的な出力...",
  "stderr": "部分的なエラー...",
  "output_truncated": true,
  "output_id": "exec_output_12345"
}
```

**新しい応答フィールド**:
- `output_id`: 完全な出力を取得するためのID（`read_execution_output`ツールで使用）

**使用例とワークフロー**:
```typescript
// 1. コマンド実行（出力が切り詰められた場合）
const result = await shell_execute({ command: "find /var/log -name '*.log'" });
// → { output_truncated: true, output_id: "exec_output_12345", ... }

// 2. LLMが完全な出力を取得
if (result.output_truncated && result.output_id) {
  const fullOutput = await read_execution_output({ 
    output_id: result.output_id 
  });
}
```

**パラメータ名の統一**:
- `file_id` → `output_id` (すべての実行出力管理ツールで統一)

### 2. ワーキングディレクトリ管理の改善

**現在の問題**:
- `shell_execute`のパラメータによるワーキングディレクトリ変更にバグがある
- デフォルトワーキングディレクトリが変更できない
- 環境変数での起動時設定ができない

**改善案**:

#### 環境変数設定
```bash
# 起動時デフォルトワーキングディレクトリ
MCP_SHELL_DEFAULT_WORKDIR=/path/to/default

# 許可されたワーキングディレクトリ（セキュリティ）
MCP_SHELL_ALLOWED_WORKDIRS=/home/user,/tmp,/var/log
```

#### 新しいツール: `shell_set_default_workdir`
```typescript
{
  name: 'shell_set_default_workdir',
  description: 'Set the default working directory for future executions',
  inputSchema: {
    working_directory: string, // 新しいデフォルトディレクトリ
    apply_to_existing_sessions?: boolean // 既存セッションにも適用するか
  }
}
```

#### 応答の改善
```json
{
  "working_directory": "/actual/working/dir",
  "default_working_directory": "/default/dir",
  "working_directory_changed": true
}
```

### 3. セキュリティ制限設定の簡素化

**現在の問題**:
- `allowed_commands`と`blocked_commands`の組み合わせが複雑
- 空の場合の挙動が不明確
- デフォルト設定との関係が複雑

**改善案**:

#### 新しいセキュリティモード
```typescript
SecurityMode = 'permissive' | 'restrictive' | 'custom'
```

#### 簡素化された設定
```typescript
{
  security_mode: SecurityMode,
  
  // permissiveモード: すべて許可（デフォルト）
  // restrictiveモード: ホワイトリストのみ許可
  // customモード: 詳細設定を使用
  
  // customモード時のみ有効
  allowed_commands?: string[],     // 許可するコマンド（空 = すべて拒否）
  blocked_commands?: string[],     // 拒否するコマンド（空 = 何も拒否しない）
  allowed_directories?: string[],  // 許可するディレクトリ
  
  // 共通設定
  max_execution_time?: number,
  max_memory_mb?: number,
  enable_network?: boolean
}
```

#### セキュリティプリセット
```typescript
// 事前定義されたセキュリティプリセット
SecurityPreset = 'development' | 'production' | 'sandbox' | 'minimal'
```

## 次のステップ

### 優先度: 高 - LLMの使いやすさに直結

1. **ExecutionModeの実装変更**
   - `adaptive`モードの実装
   - デフォルト値を`'adaptive'`に変更
   - タイムアウト時の部分出力応答機能を追加

2. **応答パラメータの改善**
   - `output_id`フィールドの追加
   - `file`関連の用語を`output`に統一
   - LLMが自然にワークフローを推測できるシンプルな応答

### 優先度: 中 - 一貫性と信頼性の向上

3. **ツール名の変更実装**
   - ファイル操作 → 実行出力管理
   - 動詞の明示化

4. **ワーキングディレクトリ管理の改善**
   - 環境変数での設定機能
   - `shell_set_default_workdir`ツールの追加
   - 既存のworking_directory変更バグの修正

### 優先度: 低 - 設定と保守性の向上

5. **セキュリティ設定の簡素化**
   - セキュリティモードの導入
   - プリセットの実装
   - 複雑な組み合わせルールの整理

6. **ドキュメントとテストの更新**
   - 新しい機能のテスト追加
   - クライアントライブラリの更新（該当する場合）

### 実装の依存関係

```
ExecutionMode改善 → 応答パラメータ改善
     ↓
ツール名変更 → ワーキングディレクトリ改善
     ↓
セキュリティ設定簡素化
```

### 段階的ロールアウト案

**Phase 1**: ExecutionModeと応答パラメータの改善
- LLMの混乱を最も効果的に減らす
- 既存機能への影響が最小

**Phase 2**: ツール名変更とワーキングディレクトリ
- APIの破壊的変更を含むため、バージョンアップが必要
- 後方互換性の検討が必要

**Phase 3**: セキュリティ設定の簡素化
- 管理者向け機能のため、影響範囲が限定的
- 既存設定からの移行パスが必要
