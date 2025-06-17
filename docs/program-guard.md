# プログラムガード機能

プログラムガード機能は、ターミナルの入力を特定のプロセスにのみ送信できるように制限するセキュリティ機能です。フォアグラウンドプロセスの情報を取得し、指定された条件と照合して入力を許可または拒否します。

## 機能概要

### ガード条件の指定

`terminal_input` の `send_to` パラメータで以下の条件を指定できます：

| 条件 | 例 | 説明 |
|------|-----|------|
| プロセス名 | `"bash"` | 指定された名前のプロセスのみに送信 |
| フルパス | `"/bin/bash"` | 指定されたパスのプロセスのみに送信 |
| PID | `"pid:12345"` | 指定されたPIDのプロセスのみに送信 |
| セッションリーダー | `"sessionleader:"` | セッションリーダーのプロセスのみに送信 |
| 制限なし | `"*"` | すべてのプロセスに送信（デフォルト） |

### フォアグラウンドプロセス情報

各ターミナルは以下のフォアグラウンドプロセス情報を持ちます：

```json
{
  "foreground_process": {
    "available": true,
    "process": {
      "pid": 12345,
      "name": "bash",
      "path": "/bin/bash",
      "sessionId": 12340,
      "isSessionLeader": true,
      "parentPid": 1234
    }
  }
}
```

## 使用方法

### 基本的な使用例

#### 1. bashプロセスのみに送信
```json
{
  "terminal_id": "terminal_123",
  "input": "echo hello",
  "send_to": "bash",
  "execute": true
}
```

#### 2. 特定のPIDのプロセスのみに送信
```json
{
  "terminal_id": "terminal_123",
  "input": "^C",
  "send_to": "pid:12345",
  "control_codes": true
}
```

#### 3. セッションリーダーのみに送信
```json
{
  "terminal_id": "terminal_123",
  "input": "logout",
  "send_to": "sessionleader:",
  "execute": true
}
```

#### 4. フォアグラウンドプロセス情報を含む出力取得
```json
{
  "terminal_id": "terminal_123",
  "include_foreground_process": true
}
```

## レスポンス形式

### terminal_input のレスポンス

```json
{
  "success": true,
  "input_sent": "echo hello",
  "control_codes_enabled": false,
  "raw_bytes_mode": false,
  "program_guard": {
    "passed": true,
    "target": "bash"
  },
  "timestamp": "2025-06-17T10:30:00Z"
}
```

### terminal_output のレスポンス（フォアグラウンドプロセス情報付き）

```json
{
  "terminal_id": "terminal_123",
  "output": "hello\\nuser@host:~$ ",
  "line_count": 2,
  "total_lines": 50,
  "has_more": true,
  "foreground_process": {
    "available": true,
    "process": {
      "pid": 12345,
      "name": "bash",
      "path": "/bin/bash",
      "sessionId": 12340,
      "isSessionLeader": true,
      "parentPid": 1234
    }
  }
}
```

## セキュリティの考慮事項

### ガード失敗時の動作

プログラムガードの条件に一致しない場合、入力は拒否されエラーが返されます：

```json
{
  "error": {
    "code": "EXECUTION_ERROR",
    "message": "Program guard failed: input rejected for target \\"vim\\""
  }
}
```

### プロセス情報取得失敗時

フォアグラウンドプロセス情報の取得に失敗した場合、ガードは安全側に倒れて入力を拒否します：

```json
{
  "foreground_process": {
    "available": false,
    "error": "Could not determine foreground process"
  }
}
```

## パフォーマンス最適化

### キャッシュ機能

- プロセス情報は1秒間キャッシュされます
- フォアグラウンドプロセス情報は5秒間キャッシュされます
- 頻繁な情報取得によるパフォーマンス低下を防ぎます

### 非同期更新

- フォアグラウンドプロセス情報は非同期で更新されます
- レスポンス時間への影響を最小化します

## 実装の詳細

### プロセス情報取得

Linux環境では以下のファイルを使用してプロセス情報を取得します：

- `/proc/{pid}/stat` - プロセス統計情報（セッションID、親PIDなど）
- `/proc/{pid}/comm` - プロセス名
- `/proc/{pid}/exe` - 実行ファイルパス（シンボリックリンク）

### フォアグラウンドプロセス検出

1. PTYプロセス（通常はシェル）を起点とする
2. 最新の子プロセスをフォアグラウンドプロセスとみなす
3. プロセスの開始時刻を比較して最新のものを選択

## エラーハンドリング

### 一般的なエラー

- **プロセス情報取得失敗**: `/proc` ファイルアクセスエラー
- **権限不足**: プロセス情報へのアクセス権限がない
- **プロセス終了**: 対象プロセスが既に終了している

### 対処法

- エラー発生時は適切なエラーメッセージを返す
- 安全側に倒れる設計（不明な場合は拒否）
- キャッシュのクリアや再試行で問題が解決する場合がある

## 制限事項

1. **Linux専用**: 現在は Linux の `/proc` ファイルシステムに依存
2. **権限**: 他のユーザーのプロセス情報は取得できない場合がある
3. **精度**: フォアグラウンドプロセスの検出は完璧ではない場合がある

## トラブルシューティング

### フォアグラウンドプロセスが検出されない

```bash
# プロセス情報を手動確認
ls -la /proc/{pid}/
cat /proc/{pid}/stat
```

### ガードが期待通りに動作しない

```bash
# 現在のフォアグラウンドプロセス情報を確認
# terminal_output で include_foreground_process=true を指定
```

### パフォーマンスの問題

```bash
# キャッシュの状況を確認
# 頻繁なプロセス情報取得を避ける
```
