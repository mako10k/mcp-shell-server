# ターミナル制御コード送信機能

`terminal_input` ツールを使用して、ターミナルに制御コード（制御文字、エスケープシーケンス）を送信できます。

## 使用方法

### 基本的な使い方

```json
{
  "terminal_id": "terminal_123",
  "input": "echo hello",
  "execute": false,
  "control_codes": false,
  "raw_bytes": false
}
```

### 制御コードの送信

制御コードを送信するには、`control_codes` を `true` に設定します：

```json
{
  "terminal_id": "terminal_123",
  "input": "^C",
  "execute": false,
  "control_codes": true
}
```

### サポートしている制御コード形式

#### 1. Ctrl+文字形式
- `^C` - Ctrl+C (プロセス中断)
- `^Z` - Ctrl+Z (プロセス一時停止)
- `^D` - Ctrl+D (EOF)
- `^L` - Ctrl+L (画面クリア)

#### 2. エスケープシーケンス
- `\n` - 改行
- `\r` - キャリッジリターン
- `\t` - タブ
- `\b` - バックスペース
- `\f` - フォームフィード
- `\v` - 垂直タブ
- `\0` - ヌル文字

#### 3. 16進数エスケープ
- `\x1b` - ESCキー (ASCII 27)
- `\x03` - Ctrl+C (ASCII 3)
- `\x04` - Ctrl+D (ASCII 4)

#### 4. 8進数エスケープ
- `\033` - ESCキー (8進数で27)
- `\003` - Ctrl+C (8進数で3)

#### 5. Unicode エスケープ
- `\u001b` - ESCキー (Unicode U+001B)
- `\u0003` - Ctrl+C (Unicode U+0003)

### 生バイト送信

16進数文字列として生のバイトデータを送信する場合：

```json
{
  "terminal_id": "terminal_123",
  "input": "1b5b413",  // ESC[A (上矢印キー)
  "execute": false,
  "control_codes": false,
  "raw_bytes": true
}
```

## 実用例

### プロセスを中断する
```json
{
  "terminal_id": "terminal_123",
  "input": "^C",
  "control_codes": true
}
```

### 画面をクリアする
```json
{
  "terminal_id": "terminal_123",
  "input": "^L",
  "control_codes": true
}
```

### ESCキーを送信する
```json
{
  "terminal_id": "terminal_123",
  "input": "\x1b",
  "control_codes": true
}
```

### ANSIエスケープシーケンスを送信する（色変更）
```json
{
  "terminal_id": "terminal_123",
  "input": "\x1b[31mRed Text\x1b[0m",
  "control_codes": true
}
```

### 矢印キーを送信する（生バイト）
```json
{
  "terminal_id": "terminal_123",
  "input": "1b5b41",  // ESC[A (上矢印)
  "raw_bytes": true
}
```

## 注意事項

1. **制御コードは慎重に使用する**: 制御コードはターミナルの状態を変更する可能性があります
2. **raw_bytes モードでは16進数文字列を使用**: バイトデータは16進数文字列として指定する必要があります
3. **履歴には記録されない**: 制御コードや生バイトは履歴に保存されません
4. **ターミナル依存**: 一部の制御コードはターミナルエミュレータに依存する場合があります

## よく使用される制御コード

| 制御コード | 16進数 | 機能 |
|-----------|--------|------|
| ^C | \x03 | プロセス中断 |
| ^D | \x04 | EOF / ログアウト |
| ^Z | \x1a | プロセス一時停止 |
| ^L | \x0c | 画面クリア |
| ESC | \x1b | エスケープキー |
| Tab | \x09 | タブ補完 |
| Enter | \x0d | コマンド実行 |
