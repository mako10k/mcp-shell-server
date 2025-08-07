import { z } from 'zod';
import {
  ExecutionModeSchema,
  ShellTypeSchema,
  ProcessSignalSchema,
  OutputTypeSchema,
  SecurityModeSchema,
  DimensionsSchema,
  EnvironmentVariablesSchema,
} from './index.js';

// Shell Operations
export const ShellExecuteParamsSchema = z.object({
  command: z.string().min(1).describe('Shell command to execute (e.g., "ls -la", "npm install", "python script.py"). Command will be validated against security restrictions. NOTE: This is MCP Shell Server - do NOT use VS Code internal run_in_terminal parameters like "explanation".'),
  comment: z.string().optional().describe('Optional comment from the LLM client explaining the intent or context behind this command execution. This helps the safety evaluator understand the broader context, but will be treated as advisory only and not blindly trusted.'),
  execution_mode: ExecutionModeSchema.default('adaptive').describe('How the command should be executed: "foreground" (wait for completion), "background" (run async), "detached" (fire-and-forget), "adaptive" (start foreground, switch to background for long-running commands)'),
  working_directory: z.string().optional().describe('Directory where the command should be executed. If not specified, uses the default working directory set by shell_set_default_workdir or the initial server directory.'),
  environment_variables: EnvironmentVariablesSchema.optional().describe('Environment variables to set for this command execution. These are added to or override the current environment.'),
  input_data: z.string().optional().describe('Standard input data to provide to the command. Useful for commands that read from stdin.'),
  input_output_id: z.string().optional().describe('Output ID from previous command execution to use as input. Alternative to input_data for pipeline operations.'),
  timeout_seconds: z.number().int().min(1).max(3600).default(60).describe('Maximum time in seconds to wait for foreground execution before switching to background or failing. Range: 1-3600 seconds.'),
  foreground_timeout_seconds: z.number().int().min(1).max(300).default(15).describe('For adaptive mode: timeout in seconds for the initial foreground phase before switching to background execution. Range: 1-300 seconds.'),
  return_partial_on_timeout: z.boolean().default(true).describe('When timeout occurs, return partial output collected so far instead of an error. Useful for monitoring long-running commands.'),
  max_output_size: z
    .number()
    .int()
    .min(1024)
    .max(100 * 1024 * 1024)
    .default(5 * 1024 * 1024)
    .describe('Maximum output size in bytes (1KB-100MB). Output will be truncated if it exceeds this limit. Default: 5MB.'),
  capture_stderr: z.boolean().default(true).describe('Whether to capture standard error output in addition to stdout. When false, stderr is discarded.'),
  session_id: z.string().optional().describe('Session ID for grouping related command executions. Used for process management and filtering in process_list.'),
  create_terminal: z.boolean().default(false).describe('Create a new interactive terminal session instead of running command directly. Use for commands requiring interactive input/output.'),
  terminal_shell: ShellTypeSchema.optional().describe('Shell type for the new terminal (bash, zsh, fish, cmd, powershell). Only used when create_terminal is true.'),
  terminal_dimensions: DimensionsSchema.optional().describe('Terminal dimensions in characters (width x height). Only used when create_terminal is true. Default: 120x30.'),
}).strict().refine(
  (data) => !(data.input_data && data.input_output_id),
  {
    message: "input_data and input_output_id cannot be specified simultaneously.",
    path: ["input_data", "input_output_id"],
  }
);

export const ShellGetExecutionParamsSchema = z.object({
  execution_id: z.string().min(1).describe('Unique execution ID returned by shell_execute. Use this to retrieve detailed information about a specific command execution.'),
});

// Process Management
export const ProcessListParamsSchema = z.object({
  status_filter: z.enum(['running', 'completed', 'failed', 'all']).optional().describe('Filter processes by their current status: "running" (active), "completed" (finished successfully), "failed" (terminated with error), or "all" (no filter)'),
  command_pattern: z.string().optional().describe('Filter processes by command text using substring match (case-insensitive). E.g., "python" will match all Python scripts.'),
  session_id: z.string().optional().describe('Filter processes by session ID. Use the same session_id provided in shell_execute to group related commands.'),
  limit: z.number().int().min(1).max(500).default(50).describe('Maximum number of results to return (1-500). Use for pagination with offset parameter.'),
  offset: z.number().int().min(0).default(0).describe('Number of results to skip for pagination. Combine with limit for paging through large result sets.'),
});

export const ProcessKillParamsSchema = z.object({
  process_id: z.number().int().min(1).describe('Process ID (PID) of the process to terminate. Get this from process_list results.'),
  signal: ProcessSignalSchema.default('TERM').describe('Signal to send to the process: "TERM" (graceful), "KILL" (immediate), "INT" (interrupt), "HUP" (hangup), "USR1", "USR2"'),
  force: z.boolean().default(false).describe('Force immediate termination if true. Bypasses graceful shutdown and sends KILL signal regardless of signal parameter.'),
});

export const ProcessMonitorParamsSchema = z.object({
  process_id: z.number().int().min(1).describe('Process ID (PID) to monitor. Get this from process_list results. Process must be currently running.'),
  monitor_interval_ms: z.number().int().min(100).max(60000).default(1000).describe('Monitoring interval in milliseconds (100ms-60s). Higher frequency provides more detailed data but uses more resources.'),
  include_metrics: z.array(z.enum(['cpu', 'memory', 'io', 'network'])).optional().describe('Specific metrics to collect: "cpu" (usage %), "memory" (RAM/swap), "io" (disk reads/writes), "network" (bytes sent/received)'),
});

// File Operations
export const FileListParamsSchema = z.object({
  output_type: OutputTypeSchema.optional().describe('Filter by output type: "stdout" (standard output), "stderr" (error output), "combined" (both), "log" (execution logs), or "all" (no filter)'),
  execution_id: z.string().optional().describe('Filter files by the execution that created them. Use execution_id from shell_execute results.'),
  name_pattern: z.string().optional().describe('Filter by filename using substring match (case-insensitive). E.g., ".log" will match all log files.'),
  limit: z.number().int().min(1).max(1000).default(100).describe('Maximum number of files to return (1-1000). Use for pagination through large file lists.'),
});

export const FileReadParamsSchema = z.object({
  output_id: z.string().min(1).describe('Unique output file ID from list_execution_outputs. Use this to read a specific output file generated by command execution.'),
  offset: z.number().int().min(0).default(0).describe('Byte offset to start reading from (0-based). Use for reading large files in chunks or continuing from previous read.'),
  size: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024)
    .default(8192)
    .describe('Number of bytes to read (1B-10MB). Larger sizes may improve efficiency but use more memory. Default: 8KB.'),
  encoding: z.string().default('utf-8').describe('Character encoding for text files (utf-8, ascii, latin1, etc.). Use "binary" for non-text files.'),
});

export const FileDeleteParamsSchema = z.object({
  output_ids: z.array(z.string().min(1)).min(1).describe('List of output file IDs to delete. Get these from list_execution_outputs. All specified files will be permanently removed.'),
  confirm: z.boolean().describe('Deletion confirmation flag. Must be set to true to proceed with deletion. Required to prevent accidental data loss.'),
});

// Terminal Management
export const TerminalCreateParamsSchema = z.object({
  session_name: z.string().optional().describe('Human-readable name for the terminal session. If not provided, a unique name will be generated. Useful for identifying terminals in terminal_list.'),
  shell_type: ShellTypeSchema.default('bash').describe('Shell to use for the terminal: "bash" (default), "zsh", "fish", "cmd" (Windows), "powershell" (Windows)'),
  dimensions: DimensionsSchema.default({ width: 120, height: 30 }).describe('Terminal size in characters (width x height). Standard terminal sizes: 80x24 (classic), 120x30 (wide), 132x43 (large)'),
  working_directory: z.string().optional().describe('Initial working directory for the terminal session. If not specified, uses the default working directory.'),
  environment_variables: EnvironmentVariablesSchema.optional().describe('Environment variables to set for the terminal session. These persist for the lifetime of the terminal.'),
  auto_save_history: z.boolean().default(true).describe('Whether to automatically save command history when the terminal is closed. Useful for session continuity.'),
});

export const TerminalListParamsSchema = z.object({
  session_name_pattern: z.string().optional().describe('Filter terminals by session name using substring match (case-insensitive). E.g., "dev" will match "development", "devtools", etc.'),
  status_filter: z.enum(['active', 'idle', 'all']).optional().describe('Filter by terminal status: "active" (currently running commands), "idle" (waiting for input), "all" (no filter)'),
  limit: z.number().int().min(1).max(200).default(50).describe('Maximum number of terminals to return (1-200). Use for pagination through large terminal lists.'),
});

export const TerminalGetParamsSchema = z.object({
  terminal_id: z.string().min(1).describe('Unique terminal ID from terminal_create or terminal_list. Use this to get detailed information about a specific terminal session.'),
});

export const TerminalInputParamsSchema = z.object({
  terminal_id: z.string().min(1).describe('Unique terminal ID from terminal_create or terminal_list. The terminal must be active to receive input.'),
  input: z.string().describe('Text input to send to the terminal. Can be commands, text, or control sequences depending on the control_codes flag.'),
  execute: z.boolean().default(false).describe('Whether to automatically press Enter after sending the input. Set to true for command execution, false for partial input.'),
  control_codes: z.boolean().default(false).describe('Whether to interpret the input as control codes and escape sequences (e.g., "\\n", "\\t", "\\x03" for Ctrl+C). Use for special key combinations.'),
  raw_bytes: z.boolean().default(false).describe('Whether to send input as raw bytes using hex string format (e.g., "48656c6c6f" for "Hello"). Advanced feature for binary data.'),
  send_to: z.string().optional().describe('Program guard target to ensure input is sent to the correct process. Can be process name, path, "pid:12345", "sessionleader:", or "*" for any process.'),
});

export const TerminalOutputParamsSchema = z.object({
  terminal_id: z.string().min(1).describe('Unique terminal ID from terminal_create or terminal_list. The terminal must exist to retrieve output.'),
  start_line: z.number().int().min(0).optional().describe('Starting line number to read from (0-based). If not specified, continues from the last read position for this terminal. Use for reading specific portions of terminal history.'),
  line_count: z.number().int().min(1).max(10000).default(50).describe('Number of lines to retrieve (1-10000). Balance between getting enough context and response size.'),
  include_ansi: z.boolean().default(false).describe('Whether to include ANSI control codes for colors and formatting. Set to true if you need to preserve terminal appearance.'),
  include_foreground_process: z.boolean().default(false).describe('Whether to include information about the currently running foreground process in the terminal.'),
});

export const TerminalResizeParamsSchema = z.object({
  terminal_id: z.string().min(1).describe('Unique terminal ID from terminal_create or terminal_list. The terminal must be active to be resized.'),
  dimensions: DimensionsSchema.describe('New terminal dimensions in characters (width x height). Should match the display environment for proper formatting.'),
});

export const TerminalCloseParamsSchema = z.object({
  terminal_id: z.string().min(1).describe('Unique terminal ID from terminal_create or terminal_list. All processes in this terminal will be terminated.'),
  save_history: z.boolean().default(true).describe('Whether to save the command history before closing. History can be restored when creating future terminals.'),
});

// Security & Monitoring
export const SecuritySetRestrictionsParamsSchema = z.object({
  security_mode: SecurityModeSchema.optional().describe('Security preset: "permissive" (basic safety only), "restrictive" (read-only commands only), or "custom" (use detailed configuration below)'),
  
  // customモード時のみ有効 - 他のモードでは無視される
  allowed_commands: z.array(z.string()).optional().describe('Whitelist of allowed commands (custom mode only). Commands not in this list will be blocked. Use command names like ["ls", "cat", "python"] or patterns.'),
  blocked_commands: z.array(z.string()).optional().describe('Blacklist of forbidden commands (custom mode only). These commands will be blocked even if in allowed_commands. Takes precedence over allowed_commands.'),
  allowed_directories: z.array(z.string()).optional().describe('List of allowed directories (custom mode only). Commands cannot access files outside these directories. Use absolute paths like ["/home/user", "/tmp"].'),
  
  // 全モード共通設定
  max_execution_time: z.number().int().min(1).max(86400).optional().describe('Maximum execution time in seconds for any command (1s-24h). Commands exceeding this limit will be terminated.'),
  max_memory_mb: z.number().int().min(1).max(32768).optional().describe('Maximum memory usage in MB for command execution (1MB-32GB). Commands exceeding this limit will be terminated.'),
  enable_network: z.boolean().default(true).describe('Whether to allow network access for executed commands. Disable for security in untrusted environments.'),
});

export const MonitoringGetStatsParamsSchema = z.object({
  include_metrics: z.array(z.enum(['processes', 'terminals', 'files', 'system'])).optional().describe('Types of statistics to include: "processes" (execution counts), "terminals" (session info), "files" (output stats), "system" (resource usage)'),
  time_range_minutes: z.number().int().min(1).max(1440).default(60).describe('Time range in minutes for statistics collection (1min-24h). Longer ranges provide more historical data but may be slower.'),
});

// New working directory setting schema
export const ShellSetDefaultWorkdirParamsSchema = z.object({
  working_directory: z.string().describe('Absolute path to set as the default working directory for all subsequent command executions. Must be an existing, accessible directory.'),
});

// Issue #15: クリーンアップ機能のスキーマ
export const CleanupSuggestionsParamsSchema = z.object({
  max_size_mb: z.number().positive().optional().describe('Size threshold in MB for cleanup warnings. Default: 50MB.'),
  max_age_hours: z.number().positive().optional().describe('Age threshold in hours for cleanup candidates. Default: 24 hours.'),
  include_warnings: z.boolean().optional().describe('Whether to include cleanup recommendations. Default: true.'),
});

export const AutoCleanupParamsSchema = z.object({
  max_age_hours: z.number().positive().optional().describe('Files older than this (in hours) will be deleted. Default: 24 hours.'),
  dry_run: z.boolean().optional().describe('If true, simulate cleanup without deleting files. Default: true for safety.'),
  preserve_recent: z.number().int().positive().optional().describe('Number of most recent files to preserve regardless of age. Default: 10.'),
});

// Command History Management
export const CommandHistoryQueryParamsSchema = z.object({
  // Pagination
  page: z.number().int().min(1).default(1).describe('Page number for pagination (1-based)'),
  page_size: z.number().int().min(1).max(100).default(20).describe('Number of entries per page (1-100)'),
  
  // Search and filtering
  query: z.string().optional().describe('Search term to filter commands (case-insensitive partial match)'),
  command_pattern: z.string().optional().describe('Filter by command using substring match (case-insensitive)'),
  working_directory: z.string().optional().describe('Filter by working directory'),
  safety_classification: z.enum(['basic_safe', 'llm_required']).optional().describe('Filter by safety classification'),
  was_executed: z.boolean().optional().describe('Filter by execution status'),
  
  // Date filtering
  date_from: z.string().optional().describe('Filter entries from this date (ISO string)'),
  date_to: z.string().optional().describe('Filter entries to this date (ISO string)'),
  
  // Individual entry reference
  entry_id: z.string().optional().describe('Get specific entry by execution_id'),
  
  // Analytics
  analytics_type: z.enum(['stats', 'patterns', 'top_commands']).optional().describe('Type of analytics to return: "stats" (general statistics), "patterns" (user confirmation patterns), "top_commands" (most frequent commands)'),
  
  // Result format
  include_full_details: z.boolean().default(false).describe('Include full entry details or just metadata with IDs'),
});

// Type exports
export type ShellExecuteParams = z.infer<typeof ShellExecuteParamsSchema>;
export type ShellGetExecutionParams = z.infer<typeof ShellGetExecutionParamsSchema>;
export type ShellSetDefaultWorkdirParams = z.infer<typeof ShellSetDefaultWorkdirParamsSchema>;
export type ProcessListParams = z.infer<typeof ProcessListParamsSchema>;
export type ProcessKillParams = z.infer<typeof ProcessKillParamsSchema>;
export type ProcessMonitorParams = z.infer<typeof ProcessMonitorParamsSchema>;
export type FileListParams = z.infer<typeof FileListParamsSchema>;
export type FileReadParams = z.infer<typeof FileReadParamsSchema>;
export type FileDeleteParams = z.infer<typeof FileDeleteParamsSchema>;
export type TerminalCreateParams = z.infer<typeof TerminalCreateParamsSchema>;
export type TerminalListParams = z.infer<typeof TerminalListParamsSchema>;
export type TerminalGetParams = z.infer<typeof TerminalGetParamsSchema>;
export type TerminalInputParams = z.infer<typeof TerminalInputParamsSchema>;
export type TerminalOutputParams = z.infer<typeof TerminalOutputParamsSchema>;
export type TerminalResizeParams = z.infer<typeof TerminalResizeParamsSchema>;
export type TerminalCloseParams = z.infer<typeof TerminalCloseParamsSchema>;
export type SecuritySetRestrictionsParams = z.infer<typeof SecuritySetRestrictionsParamsSchema>;
export type MonitoringGetStatsParams = z.infer<typeof MonitoringGetStatsParamsSchema>;
export type CleanupSuggestionsParams = z.infer<typeof CleanupSuggestionsParamsSchema>;
export type AutoCleanupParams = z.infer<typeof AutoCleanupParamsSchema>;
export type CommandHistoryQueryParams = z.infer<typeof CommandHistoryQueryParamsSchema>;
