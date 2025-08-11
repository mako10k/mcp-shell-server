// 応答形式制御のためのスキーマ

import { z } from 'zod';

// 共通の応答レベル制御
export const ResponseLevelSchema = z
  .enum(['minimal', 'standard', 'full'])
  .default('standard')
  .describe(
    'Response detail level: ' +
      'minimal (only essential data, fastest), ' +
      'standard (balanced info for most use cases), ' +
      'full (complete details, maximum information)'
  );

// 簡潔な出力制御
export const OutputFormatSchema = z.object({
  response_level: ResponseLevelSchema,
  exclude_metadata: z
    .boolean()
    .default(false)
    .describe('Exclude metadata like timestamps, IDs for cleaner output'),
  exclude_empty_fields: z
    .boolean()
    .default(true)
    .describe('Remove fields with null/empty values from response'),
  compact_arrays: z
    .boolean()
    .default(false)
    .describe('Compact array outputs by showing only count and first few items'),
  summary_only: z
    .boolean()
    .default(false)
    .describe('Return only summary information instead of detailed data'),
});

// バッチ操作結果の集約
export const BatchResultFormatSchema = z.object({
  show_individual_results: z
    .boolean()
    .default(true)
    .describe('Include individual operation results'),
  show_summary: z.boolean().default(true).describe('Include summary statistics'),
  show_errors_only: z.boolean().default(false).describe('Only show operations that had errors'),
  group_by_status: z.boolean().default(false).describe('Group results by success/failure status'),
});

export type ResponseLevel = z.infer<typeof ResponseLevelSchema>;
export type OutputFormat = z.infer<typeof OutputFormatSchema>;
export type BatchResultFormat = z.infer<typeof BatchResultFormatSchema>;
