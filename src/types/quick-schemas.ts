import { z } from 'zod';
import { ResponseLevelSchema } from './response-schemas.js';
import { ShellTypeSchema, DimensionsSchema } from './index.js';

// よく使用される操作を簡素化

// 1. クイック実行（最も一般的なパラメータで）
export const QuickExecuteParamsSchema = z.object({
  command: z.string().min(1).describe('Shell command to execute with optimized defaults'),
  directory: z.string().optional().describe('Working directory (shorthand for working_directory)'),
  timeout: z.number().int().min(1).max(3600).default(60).describe('Timeout in seconds (shorthand)'),
  response_level: ResponseLevelSchema,
});

// 2. 統合ターミナル操作 (terminal_create + terminal_send_input + terminal_get_output を統合)
export const TerminalOperateParamsSchema = z.object({
  // Terminal identification/creation
  terminal_id: z.string().optional().describe('Existing terminal ID to use. If not provided, creates new terminal when command is specified.'),
  command: z.string().optional().describe('Command to execute. Required when creating new terminal (terminal_id not provided).'),
  
  // Terminal creation options (used when terminal_id not provided)
  session_name: z.string().optional().describe('Name for new terminal session'),
  shell_type: ShellTypeSchema.default('bash').describe('Shell type for new terminal'),
  dimensions: DimensionsSchema.default({ width: 120, height: 30 }).describe('Terminal dimensions. For new terminals: initial size. For existing terminals: resize if different from current size.'),
  working_directory: z.string().optional().describe('Working directory for new terminal'),
  environment_variables: z.record(z.string()).optional().describe('Environment variables for new terminal'),
  
  // Input operations
  input: z.string().optional().describe('Input to send to terminal. Can be partial input or complete command.'),
  execute: z.boolean().default(true).describe('Whether to press Enter after sending input (execute command)'),
  control_codes: z.boolean().default(false).describe('Whether to interpret input as control codes'),
  send_to: z.string().optional().describe('Program guard target to ensure input is sent to the correct process. Can be process name, path, "pid:12345", "sessionleader:", or "*" for any process.'),
  
  // Output retrieval
  get_output: z.boolean().default(true).describe('Whether to retrieve terminal output after operations'),
  output_delay_ms: z.number().int().min(0).max(10000).default(500).describe('Delay in milliseconds before retrieving output (allows command to complete)'),
  output_lines: z.number().int().min(1).max(1000).default(20).describe('Number of output lines to retrieve'),
  include_ansi: z.boolean().default(false).describe('Include ANSI codes in output'),
  
  // Response control
  response_level: ResponseLevelSchema,
  return_terminal_info: z.boolean().default(true).describe('Include terminal information in response'),
}).refine(
  (data) => data.terminal_id || data.command,
  {
    message: "Either terminal_id (to use existing terminal) or command (to create new terminal) must be provided",
    path: ["terminal_id", "command"],
  }
);

// 3. システム概要（ダッシュボード的な情報）
export const SystemDashboardParamsSchema = z.object({
  refresh_stats: z.boolean().default(true).describe('Refresh system statistics'),
  include_recent_activity: z.boolean().default(true).describe('Include recent command/terminal activity'),
  max_recent_items: z.number().int().min(1).max(50).default(10).describe('Maximum recent items to show'),
  response_level: ResponseLevelSchema,
});

// 4. ファイル管理簡素化
export const FileQuickParamsSchema = z.object({
  action: z.enum(['list', 'clean', 'read']).describe('Quick file action'),
  pattern: z.string().optional().describe('File pattern for list/clean operations'),
  output_id: z.string().optional().describe('Output ID for read operation'),
  auto_clean: z.boolean().default(false).describe('Automatically clean old files (for clean action)'),
  max_age_hours: z.number().int().min(1).max(168).default(24).describe('Max age for cleanup'),
  response_level: ResponseLevelSchema,
});

export type QuickExecuteParams = z.infer<typeof QuickExecuteParamsSchema>;
export type TerminalOperateParams = z.infer<typeof TerminalOperateParamsSchema>;
export type SystemDashboardParams = z.infer<typeof SystemDashboardParamsSchema>;
export type FileQuickParams = z.infer<typeof FileQuickParamsSchema>;
