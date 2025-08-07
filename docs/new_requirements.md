# 高度なコマンド実行安全性機能の要求仕様書

## 概要

参考GitHub Repository（実装手法の参考用）:
- mako10k/mcp-llm-generator（LLM Sampler実装の参考）
- mako10k/mcp-confirm（Elicitation実装の参考）

## 1. 目的

コマンド実行において、以下を実現する：
- LLM Samplerによる高度なコマンド安全性評価
- シンプルな2段階判定（基本安全 or LLM評価必要）
- 文脈に応じた再実行・確認プロセス

---

## 2. 機能要件

### 2.1 シンプル安全性評価システム

#### 2.1.1 2段階判定方式
アプリケーションレベルでは以下の2段階で判定：

| 判定レベル | 分類 | 説明 | 処理方式 |
|------------|------|------|----------|
| **基本安全** | かなり安全 | リスクが低い確認系・軽微な操作 | 即座に実行 |
| **LLM評価必要** | 不明・潜在リスク | 基本安全以外の全コマンド | LLM Samplerで詳細評価 |

#### 2.1.2 LLM Sampler評価結果
LLM Samplerは以下のいずれかの結果を返す：

1. **実行許可** (`ALLOW`)
   - 安全性に問題なし、即座に実行
   - 理由と根拠を含む

2. **条件付き否認** (`CONDITIONAL_DENY`)
   - 理由を示した否認だが、再審査により改善可能
   - MCPクライアント側LLMへの具体的な改善提案を含む
   - 再審査時は前回否認内容と直前のコマンド履歴をコンテキストに追加
   - 危険なコマンドは最終的にユーザ確認が必須

3. **完全否認** (`DENY`)
   - 同コマンドでの再実行は無意味
   - `rm -rf /`等の極めて危険なコマンド
   - 明確な否認理由を含む

### 2.2 統合評価プロセス

#### 2.2.1 自動統合機能
MCPツール応答前の処理で以下を自動実行：
- **Elicitation**: 必要に応じたユーザ意図確認（ユーザ意図が絶対）
- **LLM Sampling**: コマンドの文脈的安全性評価
- **履歴参照**: 過去の実行パターン分析

#### 2.2.2 評価フロー
```
[コマンド要求]
    ↓
[基本安全性チェック]
    ↓
├─ 基本安全 → [即座実行]
└─ LLM評価必要 → [Sampler評価]
                      ↓
                 ├─ ALLOW → [実行]
                 ├─ CONDITIONAL_DENY → [改善提案 + 再審査待ち]
                 │                        ↓
                 │                   [改善コマンド実行] → [再審査要求]
                 │                        ↓
                 │                   [履歴込み再評価] → [ALLOW/DENY]
                 │                        ↓
                 │                   [ユーザ確認] → [最終実行]
                 └─ DENY → [完全拒否]
```

### 2.3 再審査・学習システム

#### 2.3.1 条件付き否認後の再審査プロセス
- CONDITIONAL_DENY応答時に改善提案を提供
- MCPクライアント側LLMが改善コマンド（確認コマンド等）を実行
- 改善後の再審査要求時に「再審査ID」と「再依頼理由」を含める
- 直前のコマンド履歴を自動的にSamplerコンテキストに追加
- 文脈を考慮した再評価でALLOW判定後、最終的にユーザ確認が必須

#### 2.3.2 再審査時の文脈追加
- 前回否認時の理由・改善提案を自動的にSamplerコンテキストに追加
- 直前に実行された確認コマンドの結果を含める
- MCPクライアント側LLMの修正意図と実行履歴を考慮した再評価
- 同一セッション内での学習効果

---

## 3. 技術要件

### 3.1 コマンド履歴管理機能（拡張実装）

#### 3.1.1 履歴データ構造
```typescript
interface CommandHistoryEntry {
  execution_id: string;
  command: string;
  timestamp: string;
  working_directory: string;
  
  // 安全性評価結果
  safety_classification: 'basic_safe' | 'llm_required';
  llm_evaluation_result?: 'ALLOW' | 'CONDITIONAL_DENY' | 'DENY';
  evaluation_reasoning: string;
  
  // 実行結果
  was_executed: boolean;
  execution_status?: 'completed' | 'failed' | 'timeout';
  
  // 再実行・学習用
  denial_context?: string;        // 否認時の改善提案
  resubmission_count: number;     // 再審査回数
  resubmission_id?: string;       // 再審査ID
  resubmission_reason?: string;   // 再依頼理由
  
  // ユーザ確認履歴（意図推測用）
  user_confirmation?: boolean;    // 最終ユーザ確認結果
  user_confirmation_context?: {   // 確認時の詳細情報
    prompt: string;               // 確認時のプロンプト内容
    user_response: string;        // ユーザの応答内容
    reasoning: string;            // ユーザの判断理由（任意）
    timestamp: string;            // 確認取得時刻
  };
  output_summary?: string;        // 実行時のみ
}
```

#### 3.1.2 履歴保持仕様
- **保持期間**: 設定可能（デフォルト30日）
- **最大件数**: 設定可能（デフォルト1000件）
- **評価結果保持**: 全ての評価プロセスを記録
- **再実行学習**: 否認→改善→再審査→許可のパターンを学習
- **ユーザ意図学習**: 確認履歴からユーザの判断パターンを分析

### 3.2 シンプル安全性分類器（新規実装）

#### 3.2.1 基本安全コマンド分類
```typescript
class BasicSafetyClassifier {
  classifyCommand(command: string): 'basic_safe' | 'llm_required' {
    // 明らかに安全なコマンドのみを basic_safe に分類
    // それ以外は全て llm_required として LLM 評価に回す
  }
  
  private readonly BASIC_SAFE_PATTERNS = [
    /^ls(\s|$)/,           // ディレクトリ一覧
    /^pwd(\s|$)/,          // 現在ディレクトリ
    /^cat\s+[^>|&;]+$/,    // ファイル表示（リダイレクト無し）
    /^grep\s+/,            // 検索
    /^head\s+/,            // 先頭表示
    /^tail\s+/,            // 末尾表示
    /^wc\s+/,              // 文字数カウント
    /^which\s+/,           // コマンドパス検索
    /^whoami(\s|$)/,       // ユーザ名表示
    /^date(\s|$)/,         // 日付表示
  ];
}
```

### 3.3 LLM評価統合（新規実装）

#### 3.3.1 内蔵Sampler機能
```typescript
interface LLMSampler {
  evaluateCommandSafety(
    command: string,
    context: EvaluationContext,
    previousDenial?: string,
    resubmissionContext?: ResubmissionContext
  ): Promise<LLMEvaluationResult>;
}

interface ResubmissionContext {
  resubmission_id: string;
  resubmission_reason: string;
  recent_command_history: CommandHistoryEntry[];  // 直前の確認コマンド等
}

interface LLMEvaluationResult {
  decision: 'ALLOW' | 'CONDITIONAL_DENY' | 'DENY';
  reasoning: string;
  improvement_suggestions?: string[];  // CONDITIONAL_DENY 時のみ
  requires_user_confirmation?: boolean; // ALLOW時の最終ユーザ確認要否
  confidence_score: number;            // 0.0-1.0
}

interface EvaluationContext {
  working_directory: string;
  recent_commands: CommandHistoryEntry[];
  user_intent?: string;                   // Elicitation結果（ユーザ意図が絶対）
  user_confirmation_history: UserConfirmationPattern[]; // ユーザ確認履歴
  session_context: SessionInfo;
}

interface UserConfirmationPattern {
  command_pattern: string;
  confirmation_rate: number;     // 確認時の許可率
  typical_reasoning: string[];   // よくある判断理由
  last_confirmed: string;        // 最後に確認した日時
}
```

### 3.4 統合確認システム（新規実装）

#### 3.4.1 内蔵Elicitation機能
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
    safety_evaluation: LLMEvaluationResult,
    user_confirmation_history: UserConfirmationPattern[]
  ): Promise<UserConfirmationResult>;
  
  // ユーザ確認履歴の分析・パターン抽出
  async analyzeUserConfirmationPatterns(
    command: string,
    history: CommandHistoryEntry[]
  ): Promise<UserConfirmationPattern[]>;
}

interface ElicitationResult {
  user_intent: string;
  clarifications: { [key: string]: string };
  confidence: number;
}

interface UserConfirmationResult {
  confirmed: boolean;
  user_comment?: string;
  user_reasoning?: string;      // ユーザの判断理由
  timestamp: string;
  confidence_level: number;     // ユーザの確信度（1-5）
}
```

---

## 4. 運用要件

### 4.1 設定管理

#### 4.1.1 新設定項目
```typescript
interface EnhancedSecurityConfig {
  // 既存設定は維持
  security_mode: 'permissive' | 'restrictive' | 'custom' | 'enhanced';
  
  // 新規設定
  enable_llm_evaluation: boolean;     // LLM評価機能の有効化
  enable_elicitation: boolean;        // 意図確認機能の有効化
  command_history_enabled: boolean;   // 履歴管理機能
  command_history_retention_days: number;  // 履歴保持期間
  max_command_history_entries: number;     // 最大履歴件数
  
  // タイムアウト設定
  llm_evaluation_timeout_ms: number;       // LLM評価タイムアウト
  elicitation_timeout_ms: number;          // 意図確認タイムアウト
  
  // 学習機能
  enable_context_learning: boolean;       // 再実行学習機能
  max_resubmission_attempts: number;      // 最大再実行回数
}
```

#### 4.1.2 段階的導入方針
- フィーチャーフラグによる機能の段階的有効化
- デフォルトは既存動作（`enhanced`モード無効）
- A/Bテスト対応可能な設計

### 4.2 パフォーマンス要件

- **基本分類**: 10ms以下
- **LLM評価**: 3秒以下（タイムアウト時は保守的拒否）
- **Elicitation**: 60秒以下（設定可能）
- **履歴検索**: 500ms以下

### 4.3 エラーハンドリング

#### 4.3.1 障害時の動作
- **LLM評価失敗時**: 保守的に拒否（CONDITIONAL_DENY相当）
- **Elicitation失敗時**: ユーザ意図不明として保守的判断
- **履歴システム障害時**: 現在のコマンドのみで評価

#### 4.3.2 ログ・監査
- 全評価プロセスの詳細ログ
- 否認→改善→許可のパターン学習ログ
- パフォーマンスメトリクス

---

## 5. 実装優先順位

### Phase 1: 基盤機能（3週間）
1. コマンド履歴管理システム（拡張版）
2. 基本安全分類器（シンプル版）
3. 設定システム拡張

### Phase 2: LLM統合（4週間）
1. 内蔵LLM Sampler機能
2. 評価結果統合処理
3. 再実行コンテキスト管理

### Phase 3: 高度機能（3週間）
1. 内蔵Elicitation機能
2. 学習・改善システム
3. 監査・レポート機能

---

## 6. 受入基準

### 6.1 機能受入基準
- [ ] 基本安全コマンドが即座に実行される
- [ ] LLM評価が適切に動作（3秒以内）
- [ ] 条件付き否認時に改善提案が提供される
- [ ] 再実行時に前回否認内容が考慮される
- [ ] コマンド履歴が適切に保存・活用される
- [ ] 既存機能への互換性が維持される

### 6.2 性能受入基準
- [ ] 基本分類: 10ms以下
- [ ] LLM評価: 3秒以下
- [ ] 履歴検索: 500ms以下
- [ ] 既存処理への性能影響: 5%以下

### 6.3 安全性受入基準
- [ ] 極めて危険なコマンドの確実な拒否
- [ ] 安全コマンドの誤拒否: 5%以下
- [ ] 評価プロセスのバイパス: 不可能
- [ ] 否認理由の明確な提示

---

## 7. アーキテクチャ設計（シンプル版）

### 7.1 システム構成
```
┌─────────────────────────────────────────────────────────────┐
│              Enhanced Security Layer                        │
├─────────────────────────────────────────────────────────────┤
│  Command Safety Pipeline                                    │
│  ├─ Basic Safety Classifier (new)                         │
│  ├─ Built-in LLM Sampler (new)                            │
│  ├─ Built-in Elicitation (new)                            │
│  └─ Decision Engine (new)                                  │
├─────────────────────────────────────────────────────────────┤
│  Command History Manager (enhanced)                        │
│  ├─ Evaluation History Storage                             │
│  ├─ Context Builder for Resubmission                      │
│  └─ Learning Pattern Recognition                           │
├─────────────────────────────────────────────────────────────┤
│  Existing MCP Shell Server Core (unchanged)                │
│  ├─ ProcessManager                                         │
│  ├─ TerminalManager                                        │
│  ├─ SecurityManager (extended)                             │
│  └─ ShellTools                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 シンプル評価フロー
```
[Command Request] 
    ↓
[Basic Safety Classification]
    ↓
├─ basic_safe → [Execute Immediately]
└─ llm_required → [Context Building]
                      ↓
                 [User Elicitation] (if needed)
                      ↓
                 [LLM Sampler Evaluation]
                      ↓
                 ├─ ALLOW → [Final User Confirmation] → [Execute]
                 ├─ CONDITIONAL_DENY → [Provide Suggestions + Wait for Resubmission]
                 └─ DENY → [Reject with Clear Reasoning]
                      ↓
                 [Update History with Full Context]
```

### 7.3 再審査時の学習フロー
```
[Resubmitted Command with Resubmission ID]
    ↓
[Load Previous Denial Context]
    ↓
[Gather Recent Command History]
    ↓
[Enhanced Context for LLM]
├─ Original Command
├─ Previous Denial Reasoning  
├─ Suggested Improvements
├─ Resubmission Reason
└─ Recent Confirmation Commands
    ↓
[Re-evaluation with Full Context]
    ↓
├─ ALLOW → [Final User Confirmation] → [Execute]
└─ DENY → [Reject with Updated Reasoning]
```

---

## 8. 詳細仕様（シンプル版）

### 8.1 基本安全分類ルール

#### 8.1.1 基本安全パターン
```typescript
class BasicSafetyClassifier {
  private readonly BASIC_SAFE_COMMANDS = [
    // 表示・確認系（引数制限あり）
    { pattern: /^ls(\s+-[lart]*)?(\s+[^|>;&]+)?$/, reasoning: "Directory listing" },
    { pattern: /^pwd$/, reasoning: "Current directory" },
    { pattern: /^whoami$/, reasoning: "Current user" },
    { pattern: /^date(\s+-[^|>;&]+)?$/, reasoning: "Date display" },
    
    // ファイル内容表示（リダイレクト無し）
    { pattern: /^cat\s+[^|>;&]+$/, reasoning: "File content display" },
    { pattern: /^head(\s+-n\s*\d+)?\s+[^|>;&]+$/, reasoning: "File head display" },
    { pattern: /^tail(\s+-n\s*\d+)?\s+[^|>;&]+$/, reasoning: "File tail display" },
    
    // 検索・フィルタ（基本形のみ）
    { pattern: /^grep\s+[^|>;&]+\s+[^|>;&]+$/, reasoning: "Simple grep search" },
    { pattern: /^wc(\s+-[lwc])?\s+[^|>;&]+$/, reasoning: "Word count" },
    { pattern: /^which\s+[a-zA-Z0-9_-]+$/, reasoning: "Command location" },
  ];
  
  classifyCommand(command: string): 'basic_safe' | 'llm_required' {
    const trimmed = command.trim();
    
    // 空コマンドは安全
    if (!trimmed) return 'basic_safe';
    
    // 基本安全パターンをチェック
    for (const rule of this.BASIC_SAFE_COMMANDS) {
      if (rule.pattern.test(trimmed)) {
        return 'basic_safe';
      }
    }
    
    // その他は全てLLM評価
    return 'llm_required';
  }
}
```

### 8.2 LLM評価プロンプト設計

#### 8.2.1 基本評価プロンプト
```typescript
const LLM_EVALUATION_PROMPT = `
あなたはシェルコマンドの安全性を評価する専門家です。
以下のコマンドを評価し、JSON形式で回答してください。

評価対象:
Command: {command}
Working Directory: {working_directory}
User Intent: {user_intent}

{resubmission_context}

評価基準:
- ALLOW: 安全に実行可能
- CONDITIONAL_DENY: 危険だが改善可能（具体的な改善提案必須）
- DENY: 極めて危険で実行不可

{previous_denial_context}

回答形式:
{
  "decision": "ALLOW|CONDITIONAL_DENY|DENY",
  "reasoning": "詳細な理由",
  "improvement_suggestions": ["改善提案1", "改善提案2"],
  "confidence_score": 0.95
}
`;
```

#### 8.2.2 再審査時のコンテキスト追加
```typescript
const RESUBMISSION_CONTEXT = `
前回の評価履歴:
- 前回コマンド: {previous_command}
- 前回判定: {previous_decision}
- 前回理由: {previous_reasoning}
- 改善提案: {previous_suggestions}

再審査情報:
- 再審査ID: {resubmission_id}
- 再依頼理由: {resubmission_reason}

直前のコマンド履歴:
{recent_command_history}

上記の確認作業を踏まえて、元のコマンドを再評価してください。
改善が確認できた場合は ALLOW を検討してください。
`;
```

### 8.3 履歴管理詳細仕様

#### 8.3.1 学習パターン認識
```typescript
interface LearningPattern {
  original_command_pattern: string;
  common_denials: DenialPattern[];
  successful_improvements: ImprovementPattern[];
  risk_reduction_methods: string[];
}

interface DenialPattern {
  reason_category: string;
  frequency: number;
  typical_suggestions: string[];
}

interface ImprovementPattern {
  modification_type: string;
  success_rate: number;
  risk_reduction: number;
}
```

### 8.4 エラーハンドリング詳細

#### 8.4.1 フォールバック戦略
```typescript
class SafetyEvaluationManager {
  async evaluateWithFallback(command: string): Promise<EvaluationResult> {
    try {
      // LLM評価を試行
      return await this.llmSampler.evaluate(command);
    } catch (error) {
      // LLM失敗時は保守的判定
      return {
        decision: 'CONDITIONAL_DENY',
        reasoning: 'LLM評価システムが利用できないため、安全のため実行を保留します。',
        improvement_suggestions: ['システム管理者に確認してください'],
        confidence_score: 0.5
      };
    }
  }
}
```

---

## 9. 実装戦略（シンプル版）

### 9.1 Phase 1: 基盤機能（3週間）

#### 9.1.1 コマンド履歴システム拡張
- 既存履歴に評価結果フィールド追加
- 否認コンテキスト保存機能
- 再実行カウンター

#### 9.1.2 基本安全分類器
- 限定的な安全コマンドパターン
- 保守的な分類ロジック（不明=LLM評価）

#### 9.1.3 設定システム拡張
```typescript
// 既存SecurityConfigに追加
interface EnhancedSecurityConfig extends SecurityConfig {
  enhanced_mode_enabled: boolean;           // default: false
  basic_safe_commands_enabled: boolean;     // default: true
  llm_evaluation_enabled: boolean;          // default: false
}
```

### 9.2 Phase 2: LLM統合（4週間）

#### 9.2.1 内蔵LLM Sampler
- OpenAI/Anthropic API直接呼び出し
- 構造化プロンプト設計
- タイムアウト・リトライ機能

#### 9.2.2 再実行コンテキスト管理
- 前回否認内容の自動追加
- 改善提案の追跡
- 学習パターンの認識

### 9.3 Phase 3: 高度機能（3週間）

#### 9.3.1 内蔵Elicitation
- ユーザ意図確認の自動化（ユーザ意図が絶対）
- 最終ユーザ確認システム（危険コマンド実行前）
- MCPプロトコル経由でクライアントに確認要求

#### 9.3.2 運用・監査機能
- 評価履歴レポート
- 否認パターン分析
- 改善効果測定

### 9.4 既存コードへの影響最小化

#### 9.4.1 SecurityManager拡張方式
```typescript
export class SecurityManager {
  // 既存メソッドは完全に保持
  async auditCommand(command: string): Promise<boolean>;
  
  // 新規メソッド追加
  async auditCommandEnhanced(command: string): Promise<EnhancedAuditResult>;
}

interface EnhancedAuditResult {
  allowed: boolean;              // 既存互換性用
  evaluation_result: EvaluationResult;
  reasoning: string;
  suggestions?: string[];
}
```

#### 9.4.2 ProcessManager統合方式
```typescript
// shell-tools.ts の execute関数に統合
async function execute(options: ExecutionOptions): Promise<ExecutionResult> {
  // 既存のセキュリティチェック
  if (!await securityManager.auditCommand(command)) {
    throw new Error('Command rejected by security manager');
  }
  
  // 新機能: enhanced モード時のみ追加チェック
  if (config.enhanced_mode_enabled) {
    const enhancedResult = await securityManager.auditCommandEnhanced(command);
    if (!enhancedResult.allowed) {
      // 詳細な否認理由を返す
      throw new EnhancedSecurityError(enhancedResult);
    }
  }
  
  // 既存の実行ロジック
  return await processManager.execute(options);
}
```

---

## 10. 最終要求仕様（シンプル実装版）

### 10.1 核心機能

#### 10.1.1 2段階シンプル分類
- **基本安全**: 明らかに安全なコマンドのみ（限定リスト）
- **LLM評価必要**: その他全て

#### 10.1.2 LLM統合評価
- **内蔵Sampler**: 外部MCPサーバー不要
- **3段階判定**: ALLOW / CONDITIONAL_DENY / DENY
- **文脈学習**: 再実行時に前回否認内容を自動追加

#### 10.1.3 拡張履歴管理
```typescript
interface CommandHistoryEntry {
  execution_id: string;
  command: string;
  timestamp: string;
  working_directory: string;
  
  // 評価結果（新規）
  safety_classification: 'basic_safe' | 'llm_required';
  llm_evaluation_result?: 'ALLOW' | 'CONDITIONAL_DENY' | 'DENY';
  evaluation_reasoning: string;
  denial_context?: string;        // 否認時の改善提案
  
  // 実行結果
  was_executed: boolean;
  execution_status?: string;
  resubmission_count: number;
  output_summary?: string;
}
```

### 10.2 実装優先度

#### ✅ 必須実装（MVP）
1. **基本安全分類器**: 限定的パターンマッチング
2. **履歴システム拡張**: 評価結果保存
3. **内蔵LLM Sampler**: 直接API呼び出し
4. **再実行学習**: 否認コンテキスト追加

#### 🔄 推奨実装
1. **内蔵Elicitation**: ユーザ意図確認とユーザ最終確認
2. **再審査システム**: 条件付き否認後の改善確認プロセス
3. **学習システム**: パターン認識・改善
4. **監査機能**: 評価履歴分析

#### ⭐ オプション実装
1. **高度分析**: 統計・レポート
2. **API連携**: 外部システム統合

### 10.3 設定仕様（最終版）

```typescript
interface EnhancedSecurityConfig extends SecurityConfig {
  // 機能切り替え
  enhanced_mode_enabled: boolean;           // default: false
  basic_safe_classification: boolean;       // default: true
  llm_evaluation_enabled: boolean;          // default: false
  elicitation_enabled: boolean;            // default: false
  
  // 履歴管理
  command_history_enhanced: boolean;        // default: true
  history_retention_days: number;          // default: 30
  max_history_entries: number;             // default: 1000
  
  // LLM設定
  llm_provider: 'openai' | 'anthropic' | 'custom';
  llm_api_key?: string;
  llm_model: string;                       // e.g., 'gpt-4', 'claude-3'
  llm_timeout_seconds: number;             // default: 3
  
  // 学習機能
  enable_resubmission_learning: boolean;   // default: true
  max_resubmission_attempts: number;       // default: 3
}
```

### 10.4 成功指標

#### 機能指標
- [ ] 基本安全コマンドの即座実行: 100%
- [ ] LLM評価の成功率: >95%
- [ ] 条件付き否認時の改善提案提供: 100%
- [ ] 再審査時の学習効果: 測定可能
- [ ] ユーザ確認プロセスの成功率: >95%

#### 性能指標
- [ ] 基本分類レスポンス: <10ms
- [ ] LLM評価レスポンス: <3秒
- [ ] 履歴検索レスポンス: <500ms

#### 安全性指標
- [ ] 極めて危険なコマンドの拒否: 100%
- [ ] 安全コマンドの誤拒否: <5%
- [ ] 危険コマンドの最終ユーザ確認: 100%
- [ ] 否認理由の明確性: ユーザ満足度>4.0/5.0

---

## 11. 結論

### 11.1 シンプル化による利点

**✅ 実装コスト削減**
- 外部MCPサーバー依存の排除
- 複雑な段階評価の簡素化
- 既存コードへの影響最小化

**✅ 運用リスク軽減**
- 単一障害点の削減
- 設定管理の簡素化
- デバッグ・保守の容易化

**✅ 即座の価値提供**
- 基本安全分類による即座の効果
- LLM評価による高度な安全性
- 学習機能による継続改善

### 11.2 実装推奨事項

1. **Phase 1優先**: 基本機能で即座の価値提供
2. **段階的展開**: フィーチャーフラグによるリスク軽減
3. **既存互換性**: 既存ユーザーへの影響ゼロ
4. **継続改善**: 運用データに基づく学習・改善

### 11.3 期待される効果

**即時効果**
- 明らかに安全なコマンドの高速実行
- 危険コマンドの事前検出・防止
- 明確な否認理由による学習促進

**継続効果**
- 再審査学習による精度向上
- 運用パターンの分析・最適化
- ユーザの安全意識向上

本仕様により、シンプルかつ効果的なコマンド実行安全性機能が実現されます。

---

## 11. 実装FIT&GAP分析

### 11.1 現在の実装状況

#### ✅ 既存機能（FIT）

**基本セキュリティ機能**
- ✅ `SecurityManager`クラスによる基本的なコマンド検証
- ✅ 3段階のセキュリティモード（`permissive`, `restrictive`, `custom`）
- ✅ 危険なパターンの検出（`detectDangerousPatterns`）
- ✅ パス制限、実行時間制限、メモリ制限

**プロセス実行・管理**
- ✅ `ProcessManager`による包括的なコマンド実行管理
- ✅ 4種類の実行モード（`foreground`, `background`, `detached`, `adaptive`）
- ✅ 実行情報の追跡（`ExecutionInfo`インターフェース）
- ✅ バックグラウンドプロセスのコールバック機能

**出力管理**
- ✅ `FileManager`による出力ファイル管理
- ✅ 出力ファイルの検索・読み取り・削除機能
- ✅ パイプライン機能（`input_output_id`による連携）

**ログ・監査**
- ✅ 内部ログシステム（`internalLog`）
- ✅ 実行プロセスの詳細情報保持
- ✅ エラーハンドリングとログ記録

#### ❌ 不足機能（GAP）

**コマンド安全性評価システム**
- ❌ 5段階の安全度レベル分類システム（新規実装必要）
- ❌ 4種類の実行判定評価（`ALLOW`, `INVESTIGATE`, `CONDITIONAL`, `DENY`）
- ❌ 文脈的危険性評価のアルゴリズム
- ❌ 安全度レベルに基づく自動判定

**コマンド履歴管理**
- ❌ 専用のコマンド履歴管理システム（`CommandHistoryManager`）
- ❌ 構造化された履歴データ（`CommandHistoryEntry`）
- ❌ 履歴ベースの文脈評価
- ❌ プライバシー配慮の機密情報フィルター

**LLM統合機能**
- ❌ `mcp-llm-generator`との連携
- ❌ 文脈的コマンド評価のLLM実行
- ❌ 評価プロンプトシステム
- ❌ LLM評価結果の統合処理

**ユーザ確認システム**
- ❌ `mcp-confirm`との連携
- ❌ 構造化された確認プロセス
- ❌ 段階的確認ワークフロー
- ❌ 確認結果の学習・保持機能

### 11.2 技術ギャップ詳細

#### 11.2.1 アーキテクチャ拡張が必要な領域

**新規クラス・モジュール**
```typescript
// 新規実装が必要
class CommandSafetyEvaluator {
  // 安全度分類と評価判定
}

class CommandHistoryManager {
  // 履歴管理と文脈構築
}

class LLMEvaluationClient {
  // LLMサーバー連携
}

class ConfirmationClient {
  // 確認サーバー連携
}

class EnhancedSecurityManager extends SecurityManager {
  // 既存SecurityManagerの拡張
}
```

**既存クラスの拡張**
```typescript
// 拡張が必要
export class ProcessManager {
  // 新機能追加
  private commandHistory: CommandHistoryManager;
  private safetyEvaluator: CommandSafetyEvaluator;
  
  // 新メソッド
  async executeCommandWithSafetyCheck(options: ExecutionOptions): Promise<ExecutionInfo>;
}

export class SecurityManager {
  // enhancedモードの追加
  // LLM評価統合
  // 履歴ベース評価
}
```

#### 11.2.2 データ構造の拡張

**新しいインターフェース**
```typescript
interface CommandHistoryEntry {
  execution_id: string;
  command: string;
  timestamp: string;
  working_directory: string;
  execution_mode: ExecutionMode;
  safety_level: number;
  evaluation_result: EvaluationResult;
  execution_status: ExecutionStatus;
  output_summary: string;
  user_confirmation?: UserConfirmation;
}

interface SafetyEvaluation {
  safety_level: number;
  evaluation_result: EvaluationResult;
  reasoning: string;
  required_confirmations: ConfirmationType[];
  suggested_alternatives?: string[];
}
```

**既存インターフェースの拡張**
```typescript
interface ExecutionInfo {
  // 既存フィールドに追加
  safety_evaluation?: SafetyEvaluation;
  confirmation_history?: ConfirmationRecord[];
  llm_evaluation?: LLMEvaluationResult;
}
```

### 11.3 実装コストとリスク評価

#### 11.3.1 実装規模見積もり

| コンポーネント | 実装工数（人日） | 複雑度 | リスク |
|---------------|------------------|---------|--------|
| CommandHistoryManager | 8-10 | 中 | 低 |
| CommandSafetyEvaluator | 12-15 | 高 | 中 |
| LLMEvaluationClient | 6-8 | 中 | 中 |
| ConfirmationClient | 4-6 | 低 | 低 |
| SecurityManager拡張 | 10-12 | 高 | 中 |
| 統合テスト・調整 | 15-20 | 高 | 高 |
| **合計** | **55-71人日** | - | - |

#### 11.3.2 技術リスク

**高リスク**
- LLM評価の信頼性と一貫性
- 外部MCPサーバーへの依存性
- 性能への影響（特にLLM評価）
- 複雑な評価ロジックのデバッグ困難性

**中リスク**
- 既存セキュリティ機能との競合
- 後方互換性の維持
- 設定管理の複雑化

**低リスク**
- コマンド履歴管理（技術的に標準的）
- 基本的な確認機能（MCPプロトコル準拠）

### 11.4 段階的実装戦略

#### Phase 1: 基盤整備（低リスク）
- コマンド履歴管理システム
- 基本的な安全度分類
- 設定拡張

#### Phase 2: 評価システム（中リスク）
- 安全性評価エンジン
- 基本的な判定ロジック
- 既存セキュリティとの統合

#### Phase 3: 外部連携（高リスク）
- LLM評価統合
- 確認システム統合
- 統合テスト

#### Phase 4: 運用機能（低リスク）
- 監査機能
- レポート機能
- 性能最適化

### 11.5 実装優先度の再評価

#### 必須機能（MVP）
1. **コマンド履歴管理**: 文脈評価の基盤
2. **安全度分類システム**: 基本的な判定機能
3. **基本確認機能**: ユーザ意図確認

#### 高価値機能
1. **LLM統合評価**: 高度な文脈判断
2. **学習機能**: 確認結果の活用
3. **詳細レポート**: 運用支援

#### オプション機能
1. **高度な分析**: パフォーマンス分析
2. **カスタム評価ルール**: 企業固有要件
3. **API連携**: 外部システム連携

---

## 12. 実装難易度とROI分析

### 12.1 機能別実装難易度

| 機能カテゴリ | 技術難易度 | 実装工数 | 保守コスト | ユーザ価値 | ROI |
|-------------|------------|----------|------------|------------|-----|
| 履歴管理 | ⭐⭐ | 低 | 低 | ⭐⭐⭐ | 高 |
| 安全度分類 | ⭐⭐⭐ | 中 | 中 | ⭐⭐⭐⭐ | 高 |
| LLM統合 | ⭐⭐⭐⭐ | 高 | 高 | ⭐⭐⭐⭐⭐ | 中 |
| 確認システム | ⭐⭐ | 低 | 低 | ⭐⭐⭐⭐ | 高 |
| 学習機能 | ⭐⭐⭐⭐⭐ | 高 | 高 | ⭐⭐⭐ | 低 |

### 12.2 推奨実装方針

**第一優先（高ROI・低リスク）**
- コマンド履歴管理
- 基本安全度分類
- ユーザ確認システム

**第二優先（中ROI・中リスク）**
- LLM統合評価（段階的導入）
- 詳細評価エンジン

---

## 13. 最終要求仕様（実装推奨版）

### 13.1 実装推奨機能セット

FIT&GAP分析の結果、以下の機能セットを段階的に実装することを推奨します：

#### Phase 1: 基盤機能（4週間、高ROI・低リスク）

**1.1 コマンド履歴管理システム**
```typescript
interface CommandHistoryEntry {
  execution_id: string;
  command: string;
  timestamp: string;
  working_directory: string;
  safety_level: number;        // 1-5の分類
  evaluation_result: string;   // 'allow'|'conditional'|'deny'
  execution_status: string;    // 'completed'|'failed'|'timeout'
  user_confirmation?: boolean; // 確認が必要だった場合のみ
}

class CommandHistoryManager {
  async addEntry(entry: CommandHistoryEntry): Promise<void>;
  async getRecentHistory(limit: number): Promise<CommandHistoryEntry[]>;
  async getContextForCommand(command: string): Promise<CommandHistoryEntry[]>;
  async cleanup(retentionDays: number): Promise<void>;
}
```

**1.2 基本安全度分類システム**
```typescript
interface SafetyClassificationRule {
  pattern: RegExp;
  base_level: number;        // 1-5
  conditions: ClassificationCondition[];
}

class CommandSafetyClassifier {
  classifyCommand(command: string, context: ExecutionContext): SafetyEvaluation;
  private applyClassificationRules(command: string): number;
  private adjustLevelByContext(baseLevel: number, context: ExecutionContext): number;
}
```

**1.3 ユーザ確認システム統合**
```typescript
class BasicConfirmationManager {
  async requestConfirmation(
    level: number, 
    command: string, 
    reasoning: string
  ): Promise<boolean>;
  private async callMCPConfirm(params: ConfirmationParams): Promise<ConfirmationResult>;
}
```

#### Phase 2: 高度評価機能（6週間、中ROI・中リスク）

**2.1 統合安全性評価エンジン**
```typescript
class EnhancedSafetyEvaluator {
  async evaluateCommand(
    command: string,
    context: ExecutionContext,
    history: CommandHistoryEntry[]
  ): Promise<SafetyEvaluation>;
  
  private async performBasicEvaluation(command: string): Promise<BasicEvaluation>;
  private async performContextualEvaluation(
    command: string, 
    history: CommandHistoryEntry[]
  ): Promise<ContextualEvaluation>;
  private async integrateEvaluationResults(
    basic: BasicEvaluation, 
    contextual: ContextualEvaluation
  ): Promise<SafetyEvaluation>;
}
```

**2.2 SecurityManager拡張**
```typescript
class EnhancedSecurityManager extends SecurityManager {
  async auditCommandEnhanced(
    command: string, 
    workingDirectory?: string
  ): Promise<SecurityDecision>;
  
  private safetyEvaluator: EnhancedSafetyEvaluator;
  private historyManager: CommandHistoryManager;
  private confirmationManager: BasicConfirmationManager;
}

interface SecurityDecision {
  action: 'allow' | 'conditional' | 'deny';
  reasoning: string;
  required_confirmations?: ConfirmationType[];
  safety_level: number;
}
```

#### Phase 3: LLM統合（オプション、4週間、中ROI・高リスク）

**3.1 LLM評価クライアント**
```typescript
class LLMEvaluationClient {
  async evaluateCommandSafety(
    command: string,
    context: EvaluationContext
  ): Promise<LLMEvaluationResult>;
  
  private async callMCPLLMGenerator(prompt: string): Promise<string>;
  private parseEvaluationResult(response: string): LLMEvaluationResult;
}

interface LLMEvaluationResult {
  safety_assessment: {
    level: number;
    confidence: number;
    reasoning: string;
  };
  risk_factors: RiskFactors;
  recommendations: EvaluationRecommendations;
}
```

### 13.2 実装プライオリティ

#### 最優先実装（必須）
1. **コマンド履歴管理**: 全ての機能の基盤
2. **基本安全度分類**: 即座に価値提供
3. **ユーザ確認統合**: 危険コマンドの安全実行

#### 高優先実装（推奨）
1. **統合評価エンジン**: 精度向上
2. **文脈的評価**: 履歴ベース判定
3. **設定拡張**: 運用柔軟性

#### 中優先実装（オプション）
1. **LLM統合評価**: 高度な判定（外部依存性あり）
2. **学習機能**: 確認結果の活用
3. **詳細レポート**: 運用支援

### 13.3 設定・運用仕様

#### 13.3.1 設定項目
```typescript
interface EnhancedSecurityConfig extends SecurityConfig {
  // 既存設定は全て維持
  
  // 新規設定（Phase 1）
  enhanced_security_enabled: boolean;        // デフォルト: false
  command_history_enabled: boolean;          // デフォルト: true
  command_history_retention_days: number;    // デフォルト: 30
  max_command_history_entries: number;       // デフォルト: 1000
  user_confirmation_enabled: boolean;        // デフォルト: true
  confirmation_timeout_seconds: number;      // デフォルト: 180
  
  // Phase 2設定
  contextual_evaluation_enabled: boolean;    // デフォルト: false
  safety_level_thresholds: {
    require_confirmation: number;             // デフォルト: 4
    auto_deny: number;                       // デフォルト: 5
  };
  
  // Phase 3設定（オプション）
  llm_evaluation_enabled: boolean;           // デフォルト: false
  llm_generator_mcp_uri?: string;
  llm_evaluation_timeout_seconds: number;    // デフォルト: 10
}
```

#### 13.3.2 段階的有効化
```typescript
// Phase 1: 基本機能のみ
{
  enhanced_security_enabled: true,
  command_history_enabled: true,
  user_confirmation_enabled: true,
  contextual_evaluation_enabled: false,
  llm_evaluation_enabled: false
}

// Phase 2: 高度評価追加
{
  enhanced_security_enabled: true,
  contextual_evaluation_enabled: true,
  // その他設定...
}

// Phase 3: LLM統合（オプション）
{
  llm_evaluation_enabled: true,
  llm_generator_mcp_uri: "stdio://path/to/mcp-llm-generator",
  // その他設定...
}
```

### 13.4 実装ガイドライン

#### 13.4.1 既存機能への影響最小化
- 新機能は`enhanced_security_enabled`フラグで制御
- デフォルトは既存動作と同等（`false`）
- 既存APIの完全後方互換性維持

#### 13.4.2 エラーハンドリング方針
- 新機能でエラーが発生した場合、既存機能にフォールバック
- ユーザには明確なエラーメッセージと回避方法を提示
- 全てのエラーを詳細ログに記録

#### 13.4.3 性能要件
- 基本評価（Phase 1）: 50ms以下の追加遅延
- 文脈評価（Phase 2）: 200ms以下の追加遅延
- LLM評価（Phase 3）: 5秒以下（タイムアウト時は基本評価）

### 13.5 成功指標

#### 13.5.1 機能指標
- [ ] 危険コマンドの誤実行: 0件
- [ ] 安全コマンドの誤拒否: <5%
- [ ] ユーザ確認プロセスの成功率: >95%
- [ ] 履歴管理システムの稼働率: >99%

#### 13.5.2 性能指標
- [ ] 既存機能への性能影響: <10%
- [ ] 基本評価の応答時間: <100ms
- [ ] 確認プロセスの応答時間: <3分

#### 13.5.3 運用指標
- [ ] 設定エラー率: <1%
- [ ] 障害時の自動復旧率: >80%
- [ ] ユーザ満足度: >4.0/5.0

---

## 14. 結論

### 14.1 要求仕様の完全性評価

本要求仕様書は以下の観点で完全性を確保しています：

**✅ 機能要件**
- コマンド安全性評価の包括的定義
- ユーザ確認プロセスの詳細仕様
- 履歴管理システムの完全設計

**✅ 技術要件**
- 既存アーキテクチャとの統合方針
- 新規コンポーネントの詳細設計
- データ構造とインターフェース定義

**✅ 運用要件**
- 段階的実装計画
- 設定管理とデプロイ戦略
- 監査・保守要件

**✅ 品質要件**
- 性能・可用性指標
- セキュリティ要件
- 後方互換性保証

### 14.2 実装推奨事項

1. **Phase 1の優先実装**: 高ROI・低リスクの基盤機能から開始
2. **段階的展開**: 各Phaseでの十分な検証後に次段階へ進行
3. **フィーチャーフラグ活用**: リスク軽減と段階的ロールアウト
4. **包括的テスト**: 既存機能への影響を確実に検証

### 14.3 期待される効果

**即時効果（Phase 1）**
- 危険コマンドの事前検出と確認
- コマンド実行履歴の可視化
- ユーザ意図確認によるミス防止

**中期効果（Phase 2）**
- 文脈に応じた高精度な安全性評価
- 運用履歴に基づく継続的改善
- 管理者向け詳細レポート

**長期効果（Phase 3）**
- AI支援による高度な危険性判定
- 学習機能による精度向上
- 企業固有要件への対応

本要求仕様書により、現在のMCP Shell Serverの安全性を段階的かつ確実に向上させることが可能になります。

