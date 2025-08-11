import { z } from 'zod';

// 実行モード
export const ExecutionModeSchema = z.enum(['foreground', 'background', 'detached', 'adaptive']);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

// 実行状態
const ExecutionStatusSchema = z.enum(['completed', 'running', 'failed', 'timeout']);
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

// シェルタイプ
export const ShellTypeSchema = z.enum(['bash', 'zsh', 'fish', 'cmd', 'powershell']);
export type ShellType = z.infer<typeof ShellTypeSchema>;

// ターミナル状態
const TerminalStatusSchema = z.enum(['active', 'idle', 'closed']);
export type TerminalStatus = z.infer<typeof TerminalStatusSchema>;

// シグナル
export const ProcessSignalSchema = z.enum(['TERM', 'KILL', 'INT', 'HUP', 'USR1', 'USR2']);
export type ProcessSignal = z.infer<typeof ProcessSignalSchema>;

// 出力タイプ
export const OutputTypeSchema = z.enum(['stdout', 'stderr', 'combined', 'log', 'all']);
export type OutputType = z.infer<typeof OutputTypeSchema>;

// エラーカテゴリ
const ErrorCategorySchema = z.enum([
  'AUTH',
  'PARAM',
  'RESOURCE',
  'EXECUTION',
  'SYSTEM',
  'SECURITY',
]);
export type ErrorCategory = z.infer<typeof ErrorCategorySchema>;

// 基本スキーマ
export const EnvironmentVariablesSchema = z
  .record(z.string(), z.string())
  .describe('Environment variables');
export type EnvironmentVariables = z.infer<typeof EnvironmentVariablesSchema>;

export const DimensionsSchema = z
  .object({
    width: z.number().int().min(1).max(500).describe('Width in characters'),
    height: z.number().int().min(1).max(200).describe('Height in lines'),
  })
  .describe('Terminal dimensions');
export type Dimensions = z.infer<typeof DimensionsSchema>;

// 出力切り捨て理由
export type OutputTruncationReason =
  | 'size_limit'
  | 'timeout'
  | 'user_interrupt'
  | 'error'
  | 'background_transition';

// 出力状態情報
export interface OutputStatus {
  complete: boolean;
  reason?: OutputTruncationReason;
  available_via_output_id: boolean;
  recommended_action?: string | undefined;
}

// Issue #14: ガイダンス情報の型定義
export interface GuidanceInfo {
  pipeline_usage: string;
  suggested_commands: string[];
  background_processing?: {
    status_check: string;
    monitoring: string;
  };
}

// 実行情報
export interface ExecutionInfo {
  execution_id: string;
  command: string;
  status: ExecutionStatus;
  exit_code?: number;
  process_id?: number;
  working_directory?: string;
  default_working_directory?: string;
  working_directory_changed?: boolean;
  environment_variables?: EnvironmentVariables;
  execution_time_ms?: number;
  memory_usage_mb?: number;
  cpu_usage_percent?: number;
  stdout?: string;
  stderr?: string;
  output_truncated?: boolean; // 後方互換性のため残す
  output_status?: OutputStatus; // 新しい詳細な出力状態
  output_id?: string;
  terminal_id?: string;
  transition_reason?: 'foreground_timeout' | 'output_size_limit'; // adaptive modeでバックグラウンドに移行した理由
  truncation_reason?: OutputTruncationReason; // 出力切り捨ての具体的理由
  next_steps?: string[]; // LLMへの推奨アクション
  message?: string; // 状況説明メッセージ
  guidance?: GuidanceInfo; // Issue #14: パイプライン処理のガイダンス
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

// システムプロセス情報（フォアグラウンドプロセス用）
export interface SystemProcessInfo {
  pid: number;
  name: string;
  path?: string;
  sessionId?: number;
  isSessionLeader: boolean;
  parentPid?: number;
}

// プログラムガード設定
export const ProgramGuardSchema = z.object({
  sendTo: z.string(), // "bash", "/bin/bash", "pid:12345", "sessionleader:", "*"
});
export type ProgramGuard = z.infer<typeof ProgramGuardSchema>;

// フォアグラウンドプロセス情報
export interface ForegroundProcessInfo {
  process?: SystemProcessInfo;
  available: boolean;
  error?: string;
}

// ターミナル情報
export interface TerminalInfo {
  terminal_id: string;
  session_name?: string;
  shell_type: ShellType;
  dimensions: Dimensions;
  process_id: number;
  status: TerminalStatus;
  working_directory: string;
  created_at: string;
  last_activity: string;
  foreground_process?: ForegroundProcessInfo;
}

// 出力ファイル情報
export interface FileInfo {
  output_id: string;
  output_type: OutputType;
  name: string;
  size: number;
  execution_id?: string;
  created_at: string;
  path: string;
}

// 監視情報
export interface MonitorInfo {
  monitor_id: string;
  process_id: number;
  status: 'active' | 'stopped';
  started_at: string;
  last_update: string;
  metrics: {
    cpu_usage_percent?: number;
    memory_usage_mb?: number;
    io_read_bytes?: number;
    io_write_bytes?: number;
    network_rx_bytes?: number;
    network_tx_bytes?: number;
  };
}

// システム統計
export interface SystemStats {
  active_processes: number;
  active_terminals: number;
  total_files: number;
  system_load: {
    load1: number;
    load5: number;
    load15: number;
  };
  memory_usage: {
    total_mb: number;
    used_mb: number;
    free_mb: number;
    available_mb: number;
  };
  uptime_seconds: number;
  collected_at: string;
}

// エラー情報
export interface ErrorInfo {
  code: string;
  message: string;
  category: ErrorCategory;
  details?: Record<string, unknown>;
  timestamp: string;
  request_id?: string;
}

// セキュリティ制限
export interface SecurityRestrictions {
  restriction_id: string;
  security_mode: SecurityMode;

  // customモード時のみ有効
  allowed_commands?: string[];
  blocked_commands?: string[];
  allowed_directories?: string[];

  // 共通設定
  max_execution_time?: number;
  max_memory_mb?: number;
  enable_network?: boolean;

  active: boolean;
  configured_at: string;
}

// セキュリティモード
export const SecurityModeSchema = z.enum([
  'permissive',
  'moderate',
  'restrictive',
  'custom',
  'enhanced',
  'enhanced-fast',
]);
export type SecurityMode = z.infer<typeof SecurityModeSchema>;

// 実行プロセス情報（Process Manager用）
export interface ExecutionProcessInfo {
  process_id: number;
  execution_id: string;
  command: string;
  status: ExecutionStatus;
  created_at: string;
  working_directory?: string;
  environment_variables?: EnvironmentVariables;
  started_at?: string;
  completed_at?: string;
}
