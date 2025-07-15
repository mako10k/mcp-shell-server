# MCP Shell Server Specification

MCP Shell Serverは、Model Context Protocol (MCP) を使用して安全かつ効率的なシェル操作環境を提供するサーバーです。

## 概要

このサーバーは以下の機能カテゴリを提供します：
- **Shell Operations**: 安全なシェルコマンドの実行と監視
- **Process Management**: プロセスライフサイクルの完全な管理
- **File Operations**: 出力ファイルとログの管理
- **Terminal Management**: インタラクティブターミナルセッションの管理
- **Security & Monitoring**: 実行制限とリアルタイム監視

## サーバー情報

- **名前**: mcp-shell-server
- **バージョン**: 2.0.0
- **プロトコル**: Model Context Protocol (MCP) v1.0
- **対応プラットフォーム**: Linux, macOS, Windows
- **セキュリティレベル**: Sandboxed Execution

## Tools

### Shell Operations

#### shell_execute

安全にシェルコマンドを実行します。サンドボックス環境での実行により、システムの安全性を確保します。
新規ターミナルセッション作成にも対応しています。

**パラメータ:**
```json
{
  "command": "string (required) - 実行するコマンド",
  "execution_mode": "string (optional, default: 'sync') - 実行モード: 'sync', 'async', 'background'",
  "working_directory": "string (optional) - 作業ディレクトリ",
  "environment_variables": "object (optional) - 環境変数の設定",
  "input_data": "string (optional) - 標準入力データ",
  "timeout_seconds": "number (optional, default: 30) - タイムアウト時間（秒）",
  "max_output_size": "number (optional, default: 1048576) - 最大出力サイズ（バイト）",
  "capture_stderr": "boolean (optional, default: true) - 標準エラー出力をキャプチャするか",
  "session_id": "string (optional) - セッションID（セッション管理用）",
  "create_terminal": "boolean (optional, default: false) - 新規インタラクティブターミナルセッションを作成",
  "terminal_shell": "string (optional) - ターミナルのシェルタイプ: 'bash', 'zsh', 'fish', 'sh', 'powershell'",
  "terminal_dimensions": "object (optional) - ターミナルの寸法 {width: number, height: number}"
}
}
```

**レスポンス:**
```json
{
  "execution_id": "string - 実行ID",
  "status": "string - 実行状態: 'completed', 'running', 'failed', 'timeout'",
  "exit_code": "number - 終了コード",
  "stdout": "string - 標準出力（max_output_size以下）",
  "stderr": "string - 標準エラー出力（max_output_size以下）",
  "output_truncated": "boolean - 出力が切り捨てられたかどうか",
  "execution_time_ms": "number - 実行時間（ミリ秒）",
  "process_id": "number (optional) - プロセスID（async/backgroundモードの場合）",
  "terminal_id": "string (optional) - ターミナルID（create_terminal=trueの場合）",
  "output_id": "string (optional) - 出力ファイルID（FileManagerで管理される場合）",
  "transition_reason": "string (optional) - adaptiveモードでのバックグラウンド移行理由: 'foreground_timeout' | 'output_size_limit'",
  "created_at": "string - 実行開始時刻（ISO8601形式）",
  "completed_at": "string (optional) - 実行完了時刻（ISO8601形式）"
}
```

#### shell_get_execution

実行情報の詳細を取得します。

**パラメータ:**
```json
{
  "execution_id": "string (required) - 実行ID"
}
```

**レスポンス:**
```json
{
  "execution_id": "string - 実行ID",
  "command": "string - 実行されたコマンド",
  "status": "string - 現在の状態",
  "exit_code": "number - 終了コード",
  "process_id": "number - プロセスID",
  "working_directory": "string - 作業ディレクトリ",
  "environment_variables": "object - 環境変数",
  "execution_time_ms": "number - 実行時間",
  "memory_usage_mb": "number - メモリ使用量（MB）",
  "cpu_usage_percent": "number - CPU使用率",
  "created_at": "string - 作成時刻",
  "started_at": "string - 開始時刻",
  "completed_at": "string (optional) - 完了時刻"
}
```

### Process Management

#### process_list

実行中またはバックグラウンドプロセスをリストします。
**パラメータ:**
```json
{
  "status_filter": "string (optional) - 状態フィルタ: 'running', 'completed', 'failed', 'all'",
  "command_pattern": "string (optional) - コマンドパターンでフィルタ",
  "session_id": "string (optional) - セッションIDでフィルタ",
  "limit": "number (optional, default: 50) - 結果数の上限",
  "offset": "number (optional, default: 0) - オフセット"
}
```

**レスポンス:**
```json
{
  "processes": "array - プロセス情報のリスト",
  "total_count": "number - 総数",
  "filtered_count": "number - フィルタ後の数"
}
```

#### process_kill

指定されたプロセスを安全に終了します。

**パラメータ:**
```json
{
  "process_id": "number (required) - プロセスID",
  "signal": "string (optional, default: 'TERM') - 送信するシグナル: 'TERM', 'KILL', 'INT'",
  "force": "boolean (optional, default: false) - 強制終了フラグ"
}
```

**レスポンス:**
```json
{
  "success": "boolean - 成功フラグ",
  "process_id": "number - プロセスID",
  "signal_sent": "string - 送信されたシグナル",
  "exit_code": "number (optional) - 終了コード",
  "message": "string - 結果メッセージ"
}
```

#### process_monitor

プロセスのリアルタイム監視を開始します。

**パラメータ:**
```json
{
  "process_id": "number (required) - プロセスID",
  "monitor_interval_ms": "number (optional, default: 1000) - 監視間隔（ミリ秒）",
  "include_metrics": "array (optional) - 監視するメトリクス: ['cpu', 'memory', 'io', 'network']"
}
```

**レスポンス:**
```json
{
  "monitor_id": "string - 監視ID",
  "process_id": "number - プロセスID",
  "status": "string - 監視状態",
  "started_at": "string - 監視開始時刻"
}
```

### File Operations

#### file_list

ファイルおよび出力ファイルをリストします。

**パラメータ:**
```json
{
  "file_type": "string (optional) - ファイルタイプ: 'output', 'log', 'temp', 'all'",
  "execution_id": "string (optional) - 実行IDでフィルタ",
  "name_pattern": "string (optional) - ファイル名パターン",
  "limit": "number (optional, default: 100) - 結果数の上限"
}
```

**レスポンス:**
```json
{
  "files": "array - ファイル情報のリスト",
  "total_count": "number - 総数"
}
```

#### file_read

ファイルの内容を読み取ります。

**パラメータ:**
```json
{
  "file_id": "string (required) - ファイルID",
  "offset": "number (optional, default: 0) - 読み取り開始位置",
  "size": "number (optional, default: 8192) - 読み取りサイズ",
  "encoding": "string (optional, default: 'utf-8') - 文字エンコーディング"
}
```

**レスポンス:**
```json
{
  "file_id": "string - ファイルID",
  "content": "string - ファイル内容",
  "size": "number - 読み取ったサイズ",
  "total_size": "number - ファイルの総サイズ",
  "is_truncated": "boolean - 内容が切り捨てられたかどうか",
  "encoding": "string - 使用された文字エンコーディング"
}
```

#### file_delete

指定されたファイルを削除します。

**パラメータ:**
```json
{
  "file_ids": "array (required) - 削除するファイルIDのリスト",
  "confirm": "boolean (required) - 削除確認フラグ"
}
```

**レスポンス:**
```json
{
  "deleted_files": "array - 削除されたファイルIDのリスト",
  "failed_files": "array - 削除に失敗したファイルIDのリスト",
  "total_deleted": "number - 削除されたファイル数"
}
```

### Terminal Management

#### terminal_create

新しいインタラクティブターミナルセッションを作成します。
**パラメータ:**
```json
{
  "session_name": "string (optional) - セッション名",
  "shell_type": "string (optional, default: 'bash') - シェルタイプ: 'bash', 'zsh', 'fish', 'cmd', 'powershell'",
  "dimensions": {
    "width": "number (optional, default: 120) - ターミナル幅（文字数）",
    "height": "number (optional, default: 30) - ターミナル高さ（行数）"
  },
  "working_directory": "string (optional) - 初期作業ディレクトリ",
  "environment_variables": "object (optional) - 環境変数の設定",
  "auto_save_history": "boolean (optional, default: true) - 履歴の自動保存"
}
```

**レスポンス:**
```json
{
  "terminal_id": "string - ターミナルID",
  "session_name": "string - セッション名",
  "shell_type": "string - シェルタイプ",
  "dimensions": "object - ターミナルサイズ",
  "process_id": "number - シェルプロセスID",
  "created_at": "string - 作成時刻（ISO8601形式）"
}
```

#### terminal_list

アクティブなターミナルセッションをリストします。

**パラメータ:**
```json
{
  "session_name_pattern": "string (optional) - セッション名パターン",
  "status_filter": "string (optional) - 状態フィルタ: 'active', 'idle', 'all'",
  "limit": "number (optional, default: 50) - 結果数の上限"
}
```

**レスポンス:**
```json
{
  "terminals": "array - ターミナル情報のリスト",
  "total_count": "number - 総数"
}
```

#### terminal_get

ターミナルの詳細情報を取得します。

**パラメータ:**
```json
{
  "terminal_id": "string (required) - ターミナルID"
}
```

**レスポンス:**
```json
{
  "terminal_id": "string - ターミナルID",
  "session_name": "string - セッション名",
  "shell_type": "string - シェルタイプ",
  "dimensions": "object - ターミナルサイズ",
  "process_id": "number - シェルプロセスID",
  "status": "string - 現在の状態",
  "working_directory": "string - 現在の作業ディレクトリ",
  "created_at": "string - 作成時刻",
  "last_activity": "string - 最終活動時刻"
}
```

#### terminal_input

ターミナルに入力を送信します。

**パラメータ:**
```json
{
  "terminal_id": "string (required) - ターミナルID",
  "input": "string (required) - 入力内容",
  "execute": "boolean (optional, default: false) - 自動実行フラグ（Enterキーを送信）",
  "control_codes": "boolean (optional, default: false) - 制御コードとエスケープシーケンスとして解釈",
  "raw_bytes": "boolean (optional, default: false) - 生バイト送信（16進数文字列形式）",
  "send_to": "string (optional) - プログラムガード対象: プロセス名、パス、\"pid:12345\"、\"sessionleader:\"、\"*\""
}
```

**レスポンス:**
```json
{
  "success": "boolean - 成功フラグ",
  "input_sent": "string - 送信された入力",
  "control_codes_enabled": "boolean - 制御コードモードが有効だったか",
  "raw_bytes_mode": "boolean - 生バイトモードが有効だったか",
  "program_guard": "object (optional) - プログラムガード結果",
  "timestamp": "string - 送信時刻"
}
```

#### terminal_output

ターミナルの出力を取得します。

**パラメータ:**
```json
{
  "terminal_id": "string (required) - ターミナルID",
  "start_line": "number (optional, default: 0) - 開始行番号",
  "line_count": "number (optional, default: 100) - 取得行数",
  "include_ansi": "boolean (optional, default: false) - ANSI制御コードを含めるか"
}
```

**レスポンス:**
```json
{
  "terminal_id": "string - ターミナルID",
  "output": "string - ターミナル出力",
  "line_count": "number - 実際の行数",
  "total_lines": "number - 出力の総行数",
  "has_more": "boolean - さらに出力があるかどうか"
}
```

#### terminal_resize

ターミナルのサイズを変更します。

**パラメータ:**
```json
{
  "terminal_id": "string (required) - ターミナルID",
  "dimensions": {
    "width": "number (required) - 新しい幅",
    "height": "number (required) - 新しい高さ"
  }
}
```

**レスポンス:**
```json
{
  "success": "boolean - 成功フラグ",
  "terminal_id": "string - ターミナルID",
  "dimensions": "object - 新しいサイズ",
  "updated_at": "string - 更新時刻"
}
```

#### terminal_close

ターミナルセッションを終了します。

**パラメータ:**
```json
{
  "terminal_id": "string (required) - ターミナルID",
  "save_history": "boolean (optional, default: true) - 履歴を保存するか"
}
```

**レスポンス:**
```json
{
  "success": "boolean - 成功フラグ",
  "terminal_id": "string - 終了されたターミナルID",
  "history_saved": "boolean - 履歴が保存されたかどうか",
  "closed_at": "string - 終了時刻"
}
```

### Security & Monitoring

#### security_set_restrictions

実行制限を設定します。

**パラメータ:**
```json
{
  "allowed_commands": "array (optional) - 許可するコマンドのリスト",
  "blocked_commands": "array (optional) - 禁止するコマンドのリスト",
  "allowed_directories": "array (optional) - アクセス可能なディレクトリ",
  "max_execution_time": "number (optional) - 最大実行時間（秒）",
  "max_memory_mb": "number (optional) - 最大メモリ使用量（MB）",
  "enable_network": "boolean (optional, default: true) - ネットワークアクセスを許可するか"
}
```

**レスポンス:**
```json
{
  "restriction_id": "string - 制限設定ID",
  "active": "boolean - 制限が有効かどうか",
  "configured_at": "string - 設定時刻"
}
```

#### monitoring_get_stats

システム全体の統計情報を取得します。

**パラメータ:**
```json
{
  "include_metrics": "array (optional) - 取得するメトリクス: ['processes', 'terminals', 'files', 'system']",
  "time_range_minutes": "number (optional, default: 60) - 時間範囲（分）"
}
```

**レスポンス:**
```json
{
  "active_processes": "number - アクティブプロセス数",
  "active_terminals": "number - アクティブターミナル数",
  "total_files": "number - 管理されているファイル数",
  "system_load": "object - システム負荷情報",
  "memory_usage": "object - メモリ使用状況",
  "uptime_seconds": "number - サーバー稼働時間",
  "collected_at": "string - 収集時刻"
}
```

## エラー処理

すべてのツールは統一されたエラーレスポンス形式を使用します：

```json
{
  "error": {
    "code": "string - エラーコード",
    "message": "string - エラーメッセージ",
    "category": "string - エラーカテゴリ",
    "details": "object (optional) - 追加のエラー詳細",
    "timestamp": "string - エラー発生時刻（ISO8601形式）",
    "request_id": "string - リクエストID（トレース用）"
  }
}
```

### エラーコードとカテゴリ

#### 認証・認可エラー (AUTH)
- `AUTH_001`: 認証が必要
- `AUTH_002`: 認証情報が無効
- `AUTH_003`: アクセス権限が不足

#### パラメータエラー (PARAM)
- `PARAM_001`: 必須パラメータが不足
- `PARAM_002`: パラメータの値が無効
- `PARAM_003`: パラメータの形式が不正

#### リソースエラー (RESOURCE)
- `RESOURCE_001`: プロセスが見つからない
- `RESOURCE_002`: ターミナルが見つからない
- `RESOURCE_003`: ファイルが見つからない
- `RESOURCE_004`: リソースが既に存在
- `RESOURCE_005`: リソース制限に達している

#### 実行エラー (EXECUTION)
- `EXECUTION_001`: コマンド実行に失敗
- `EXECUTION_002`: タイムアウトが発生
- `EXECUTION_003`: メモリ不足
- `EXECUTION_004`: ディスク容量不足
- `EXECUTION_005`: ネットワークエラー

#### システムエラー (SYSTEM)
- `SYSTEM_001`: 内部サーバーエラー
- `SYSTEM_002`: サービスが利用できない
- `SYSTEM_003`: 設定エラー

#### セキュリティエラー (SECURITY)
- `SECURITY_001`: 危険なコマンドが検出された
- `SECURITY_002`: 禁止されたディレクトリへのアクセス
- `SECURITY_003`: セキュリティポリシー違反

## セキュリティ機能

### サンドボックス実行
- すべてのコマンドは隔離された環境で実行
- ファイルシステムアクセスの制限
- ネットワークアクセスの制御

### コマンド制限
- 危険なコマンドの自動検出と禁止
- ホワイトリスト/ブラックリストによる制御
- 実行時間とリソース使用量の制限

### 監査ログ
- すべての実行ログの記録
- セキュリティイベントの追跡
- アクセスパターンの分析

## パフォーマンスと制限

### デフォルト制限値
- 最大同時実行プロセス数: 50
- 最大ターミナルセッション数: 20
- 最大ファイルサイズ: 100MB
- 最大実行時間: 300秒
- 最大メモリ使用量: 1GB

### スケーラビリティ
- 非同期処理による高いスループット
- 効率的なリソース管理
- 自動的なガベージコレクション

## 使用例

### 基本的なコマンド実行
```json
{
  "tool": "shell_execute",
  "parameters": {
    "command": "ls -la /home/user",
    "execution_mode": "sync",
    "working_directory": "/home/user"
  }
}
```

### バックグラウンドプロセスの実行
```json
{
  "tool": "shell_execute",
  "parameters": {
    "command": "python long_running_script.py",
    "execution_mode": "background",
    "timeout_seconds": 3600
  }
}
```

### 新規ターミナルセッションの作成（shell_execute経由）
```json
{
  "tool": "shell_execute",
  "parameters": {
    "command": "vim my_file.txt",
    "create_terminal": true,
    "terminal_shell": "bash",
    "terminal_dimensions": {
      "width": 120,
      "height": 40
    },
    "working_directory": "/home/user/project"
  }
}
```

### インタラクティブシェルの開始
```json
{
  "tool": "shell_execute",
  "parameters": {
    "command": "bash",
    "create_terminal": true,
    "terminal_shell": "bash",
    "session_id": "interactive-session-001"
  }
}
```

### ターミナルセッションの作成と操作
```json
{
  "tool": "terminal_create",
  "parameters": {
    "session_name": "dev-session",
    "shell_type": "bash",
    "dimensions": {"width": 120, "height": 40}
  }
}
```

## 実装ガイドライン

### クライアント実装
1. **エラーハンドリング**: すべてのエラーレスポンスを適切に処理
2. **リソース管理**: 不要なプロセスやターミナルの適切なクリーンアップ
3. **セキュリティ**: 入力値の検証とサニタイゼーション

### サーバー実装
1. **並行性**: 複数の実行要求の効率的な処理
2. **監視**: リソース使用量とパフォーマンスの監視
3. **ログ**: 詳細な実行ログと監査証跡の記録

### デプロイメント
1. **コンテナ化**: Dockerを使用した隔離された実行環境
2. **設定管理**: 環境に応じたセキュリティポリシーの設定
3. **監視**: 健全性チェックとメトリクス収集

## 変更履歴

- **v2.0.0 (2025-06-13)**: 
  - 完全なAPI再設計
  - セキュリティ機能の強化
  - パフォーマンス改善
  - 新しいターミナル管理機能
  - 包括的な監視機能の追加

