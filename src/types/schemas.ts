import { z } from 'zod';
import {
  ExecutionModeSchema,
  ShellTypeSchema,
  ProcessSignalSchema,
  FileTypeSchema,
  DimensionsSchema,
  EnvironmentVariablesSchema,
} from './index.js';

// Shell Operations
export const ShellExecuteParamsSchema = z.object({
  command: z.string().min(1).describe('Command to execute'),
  execution_mode: ExecutionModeSchema.default('sync').describe('Execution mode'),
  working_directory: z.string().optional().describe('Working directory'),
  environment_variables: EnvironmentVariablesSchema.optional().describe('Environment variables'),
  input_data: z.string().optional().describe('Standard input data'),
  timeout_seconds: z.number().int().min(1).max(3600).default(30).describe('Timeout in seconds'),
  max_output_size: z
    .number()
    .int()
    .min(1024)
    .max(100 * 1024 * 1024)
    .default(1048576)
    .describe('Maximum output size in bytes'),
  capture_stderr: z.boolean().default(true).describe('Capture standard error output'),
  session_id: z.string().optional().describe('Session ID for session management'),
  create_terminal: z.boolean().default(false).describe('Create a new interactive terminal session instead of running command directly'),
  terminal_shell: ShellTypeSchema.optional().describe('Shell type for the new terminal (only used when create_terminal is true)'),
  terminal_dimensions: DimensionsSchema.optional().describe('Terminal dimensions (only used when create_terminal is true)'),
});

export const ShellGetExecutionParamsSchema = z.object({
  execution_id: z.string().min(1).describe('Execution ID'),
});

// Process Management
export const ProcessListParamsSchema = z.object({
  status_filter: z.enum(['running', 'completed', 'failed', 'all']).optional().describe('Filter by process status'),
  command_pattern: z.string().optional().describe('Filter by command pattern'),
  session_id: z.string().optional().describe('Filter by session ID'),
  limit: z.number().int().min(1).max(500).default(50).describe('Maximum number of results'),
  offset: z.number().int().min(0).default(0).describe('Offset for pagination'),
});

export const ProcessKillParamsSchema = z.object({
  process_id: z.number().int().min(1).describe('Process ID'),
  signal: ProcessSignalSchema.default('TERM').describe('Signal to send'),
  force: z.boolean().default(false).describe('Force termination flag'),
});

export const ProcessMonitorParamsSchema = z.object({
  process_id: z.number().int().min(1).describe('Process ID'),
  monitor_interval_ms: z.number().int().min(100).max(60000).default(1000).describe('Monitoring interval in milliseconds'),
  include_metrics: z.array(z.enum(['cpu', 'memory', 'io', 'network'])).optional().describe('Metrics to monitor'),
});

// File Operations
export const FileListParamsSchema = z.object({
  file_type: FileTypeSchema.optional().describe('Filter by file type'),
  execution_id: z.string().optional().describe('Filter by execution ID'),
  name_pattern: z.string().optional().describe('Filter by filename pattern'),
  limit: z.number().int().min(1).max(1000).default(100).describe('Maximum number of results'),
});

export const FileReadParamsSchema = z.object({
  file_id: z.string().min(1).describe('File ID'),
  offset: z.number().int().min(0).default(0).describe('Read offset'),
  size: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024)
    .default(8192)
    .describe('Read size'),
  encoding: z.string().default('utf-8').describe('Character encoding'),
});

export const FileDeleteParamsSchema = z.object({
  file_ids: z.array(z.string().min(1)).min(1).describe('List of file IDs to delete'),
  confirm: z.boolean().describe('Deletion confirmation flag'),
});

// Terminal Management
export const TerminalCreateParamsSchema = z.object({
  session_name: z.string().optional().describe('Session name'),
  shell_type: ShellTypeSchema.default('bash').describe('Shell type'),
  dimensions: DimensionsSchema.default({ width: 120, height: 30 }).describe('Terminal dimensions'),
  working_directory: z.string().optional().describe('Initial working directory'),
  environment_variables: EnvironmentVariablesSchema.optional().describe('Environment variables'),
  auto_save_history: z.boolean().default(true).describe('Auto-save command history'),
});

export const TerminalListParamsSchema = z.object({
  session_name_pattern: z.string().optional().describe('Session name pattern'),
  status_filter: z.enum(['active', 'idle', 'all']).optional().describe('Filter by status'),
  limit: z.number().int().min(1).max(200).default(50).describe('Maximum number of results'),
});

export const TerminalGetParamsSchema = z.object({
  terminal_id: z.string().min(1).describe('Terminal ID'),
});

export const TerminalInputParamsSchema = z.object({
  terminal_id: z.string().min(1).describe('Terminal ID'),
  input: z.string().describe('Input content to send to terminal'),
  execute: z.boolean().default(false).describe('Auto-execute flag (send Enter key)'),
  control_codes: z.boolean().default(false).describe('Interpret input as control codes and escape sequences'),
  raw_bytes: z.boolean().default(false).describe('Send input as raw bytes (hex string format)'),
  send_to: z.string().optional().describe('Program guard target: process name, path, "pid:12345", "sessionleader:", or "*"'),
});

export const TerminalOutputParamsSchema = z.object({
  terminal_id: z.string().min(1).describe('Terminal ID'),
  start_line: z.number().int().min(0).default(0).describe('Start line number'),
  line_count: z.number().int().min(1).max(10000).default(100).describe('Number of lines to get'),
  include_ansi: z.boolean().default(false).describe('Include ANSI control codes'),
  include_foreground_process: z.boolean().default(false).describe('Include foreground process information'),
});

export const TerminalResizeParamsSchema = z.object({
  terminal_id: z.string().min(1).describe('Terminal ID'),
  dimensions: DimensionsSchema.describe('New dimensions'),
});

export const TerminalCloseParamsSchema = z.object({
  terminal_id: z.string().min(1).describe('Terminal ID'),
  save_history: z.boolean().default(true).describe('Save command history'),
});

// Security & Monitoring
export const SecuritySetRestrictionsParamsSchema = z.object({
  allowed_commands: z.array(z.string()).optional().describe('List of allowed commands'),
  blocked_commands: z.array(z.string()).optional().describe('List of blocked commands'),
  allowed_directories: z.array(z.string()).optional().describe('List of allowed directories'),
  max_execution_time: z.number().int().min(1).max(86400).optional().describe('Maximum execution time in seconds'),
  max_memory_mb: z.number().int().min(1).max(32768).optional().describe('Maximum memory usage in MB'),
  enable_network: z.boolean().default(true).describe('Enable network access'),
});

export const MonitoringGetStatsParamsSchema = z.object({
  include_metrics: z.array(z.enum(['processes', 'terminals', 'files', 'system'])).optional().describe('Metrics to include'),
  time_range_minutes: z.number().int().min(1).max(1440).default(60).describe('Time range in minutes'),
});

// Type exports
export type ShellExecuteParams = z.infer<typeof ShellExecuteParamsSchema>;
export type ShellGetExecutionParams = z.infer<typeof ShellGetExecutionParamsSchema>;
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
