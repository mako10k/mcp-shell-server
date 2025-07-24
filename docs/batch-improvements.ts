// バッチ処理改善の実装例

// 1. 複数プロセスの一括管理
interface BatchProcessRequest {
  commands: Array<{
    id: string;
    command: string;
    working_directory?: string;
    environment_variables?: Record<string, string>;
  }>;
  execution_mode?: 'sequential' | 'parallel';
  failure_strategy?: 'stop_on_error' | 'continue' | 'rollback';
  batch_timeout_seconds?: number;
}

// 2. 複数ファイルの一括操作
interface BatchFileOperation {
  operations: Array<{
    type: 'read' | 'delete';
    output_id?: string;
    pattern?: string;
  }>;
  parallel?: boolean;
}

// 3. ターミナルセッション一括管理
interface BatchTerminalOperation {
  terminals: string[];
  operation: 'close' | 'resize' | 'send_input';
  parameters: any;
}
