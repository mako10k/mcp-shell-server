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
  command: z.string().min(1),
  execution_mode: ExecutionModeSchema.default('sync'),
  working_directory: z.string().optional(),
  environment_variables: EnvironmentVariablesSchema.optional(),
  input_data: z.string().optional(),
  timeout_seconds: z.number().int().min(1).max(3600).default(30),
  max_output_size: z.number().int().min(1024).max(100 * 1024 * 1024).default(1048576),
  capture_stderr: z.boolean().default(true),
  session_id: z.string().optional(),
  create_terminal: z.boolean().default(false),
  terminal_shell: ShellTypeSchema.optional(),
  terminal_dimensions: DimensionsSchema.optional(),
});

export const ShellGetExecutionParamsSchema = z.object({
  execution_id: z.string().min(1),
});

// Process Management
export const ProcessListParamsSchema = z.object({
  status_filter: z.enum(['running', 'completed', 'failed', 'all']).optional(),
  command_pattern: z.string().optional(),
  session_id: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0),
});

export const ProcessKillParamsSchema = z.object({
  process_id: z.number().int().min(1),
  signal: ProcessSignalSchema.default('TERM'),
  force: z.boolean().default(false),
});

export const ProcessMonitorParamsSchema = z.object({
  process_id: z.number().int().min(1),
  monitor_interval_ms: z.number().int().min(100).max(60000).default(1000),
  include_metrics: z.array(z.enum(['cpu', 'memory', 'io', 'network'])).optional(),
});

// File Operations
export const FileListParamsSchema = z.object({
  file_type: FileTypeSchema.optional(),
  execution_id: z.string().optional(),
  name_pattern: z.string().optional(),
  limit: z.number().int().min(1).max(1000).default(100),
});

export const FileReadParamsSchema = z.object({
  file_id: z.string().min(1),
  offset: z.number().int().min(0).default(0),
  size: z.number().int().min(1).max(10 * 1024 * 1024).default(8192),
  encoding: z.string().default('utf-8'),
});

export const FileDeleteParamsSchema = z.object({
  file_ids: z.array(z.string().min(1)).min(1),
  confirm: z.boolean(),
});

// Terminal Management
export const TerminalCreateParamsSchema = z.object({
  session_name: z.string().optional(),
  shell_type: ShellTypeSchema.default('bash'),
  dimensions: DimensionsSchema.default({ width: 120, height: 30 }),
  working_directory: z.string().optional(),
  environment_variables: EnvironmentVariablesSchema.optional(),
  auto_save_history: z.boolean().default(true),
});

export const TerminalListParamsSchema = z.object({
  session_name_pattern: z.string().optional(),
  status_filter: z.enum(['active', 'idle', 'all']).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const TerminalGetParamsSchema = z.object({
  terminal_id: z.string().min(1),
});

export const TerminalInputParamsSchema = z.object({
  terminal_id: z.string().min(1),
  input: z.string(),
  execute: z.boolean().default(false),
});

export const TerminalOutputParamsSchema = z.object({
  terminal_id: z.string().min(1),
  start_line: z.number().int().min(0).default(0),
  line_count: z.number().int().min(1).max(10000).default(100),
  include_ansi: z.boolean().default(false),
});

export const TerminalResizeParamsSchema = z.object({
  terminal_id: z.string().min(1),
  dimensions: DimensionsSchema,
});

export const TerminalCloseParamsSchema = z.object({
  terminal_id: z.string().min(1),
  save_history: z.boolean().default(true),
});

// Security & Monitoring
export const SecuritySetRestrictionsParamsSchema = z.object({
  allowed_commands: z.array(z.string()).optional(),
  blocked_commands: z.array(z.string()).optional(),
  allowed_directories: z.array(z.string()).optional(),
  max_execution_time: z.number().int().min(1).max(86400).optional(),
  max_memory_mb: z.number().int().min(1).max(32768).optional(),
  enable_network: z.boolean().default(true),
});

export const MonitoringGetStatsParamsSchema = z.object({
  include_metrics: z.array(z.enum(['processes', 'terminals', 'files', 'system'])).optional(),
  time_range_minutes: z.number().int().min(1).max(1440).default(60),
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
