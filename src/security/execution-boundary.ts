export type ExecutionBoundary =
  | { kind: 'host' }
  | { kind: 'sandbox'; profile: 'restrictive-v1' };

export interface ExecutionRoute {
  remote: boolean;
  executionMode: 'foreground' | 'background' | 'detached' | 'adaptive';
  createTerminal: boolean;
  hasEnvironmentOverrides: boolean;
}
