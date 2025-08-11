import { z } from 'zod';

// 1. バッチコマンド実行
export const BatchExecuteParamsSchema = z.object({
  commands: z
    .array(
      z.object({
        id: z.string().describe('Unique identifier for this command in the batch'),
        command: z.string().min(1).describe('Shell command to execute'),
        working_directory: z.string().optional().describe('Directory for this specific command'),
        environment_variables: z
          .record(z.string())
          .optional()
          .describe('Environment variables for this command'),
        timeout_seconds: z
          .number()
          .int()
          .min(1)
          .max(3600)
          .optional()
          .describe('Individual timeout for this command'),
      })
    )
    .min(1)
    .max(10)
    .describe('Array of commands to execute (max 10 for safety)'),
  execution_mode: z
    .enum(['sequential', 'parallel'])
    .default('sequential')
    .describe(
      'How to execute the commands: sequential (one after another) or parallel (all at once)'
    ),
  failure_strategy: z
    .enum(['stop_on_error', 'continue', 'best_effort'])
    .default('stop_on_error')
    .describe('What to do when a command fails'),
  batch_timeout_seconds: z
    .number()
    .int()
    .min(10)
    .max(3600)
    .default(300)
    .describe('Overall timeout for the entire batch'),
  return_individual_outputs: z
    .boolean()
    .default(true)
    .describe('Return individual command outputs or just summary'),
});

// 2. バッチファイル操作
export const BatchFileOperationParamsSchema = z.object({
  operations: z
    .array(
      z.object({
        type: z.enum(['read', 'delete']).describe('Type of operation to perform'),
        output_id: z.string().optional().describe('Output ID for read/delete operations'),
        pattern: z.string().optional().describe('Pattern for bulk operations (e.g., "*.log")'),
        encoding: z.string().default('utf-8').describe('Encoding for read operations'),
        max_size: z.number().int().optional().describe('Max size to read per file'),
      })
    )
    .min(1)
    .max(20)
    .describe('Array of file operations to perform'),
  parallel: z
    .boolean()
    .default(true)
    .describe('Execute operations in parallel for better performance'),
  continue_on_error: z
    .boolean()
    .default(true)
    .describe('Continue processing other files if one fails'),
});

// 3. ターミナル一括操作
export const BatchTerminalOperationParamsSchema = z.object({
  terminal_ids: z.array(z.string()).min(1).max(10).describe('Array of terminal IDs to operate on'),
  operation: z
    .enum(['close', 'resize', 'send_input', 'get_output'])
    .describe('Operation to perform on all terminals'),
  parameters: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Parameters specific to the operation'),
  parallel: z.boolean().default(true).describe('Execute operation on all terminals in parallel'),
});

// 4. システム状況一括取得
export const SystemOverviewParamsSchema = z.object({
  include_processes: z.boolean().default(true).describe('Include active processes information'),
  include_terminals: z.boolean().default(true).describe('Include terminal sessions information'),
  include_files: z.boolean().default(true).describe('Include output files summary'),
  include_system_stats: z.boolean().default(true).describe('Include system resource statistics'),
  include_security: z.boolean().default(false).describe('Include current security settings'),
  summary_only: z
    .boolean()
    .default(false)
    .describe('Return only summary statistics, not detailed lists'),
});

export type BatchExecuteParams = z.infer<typeof BatchExecuteParamsSchema>;
export type BatchFileOperationParams = z.infer<typeof BatchFileOperationParamsSchema>;
export type BatchTerminalOperationParams = z.infer<typeof BatchTerminalOperationParamsSchema>;
export type SystemOverviewParams = z.infer<typeof SystemOverviewParamsSchema>;
