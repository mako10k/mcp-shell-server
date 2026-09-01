import type { ShellExecuteParams } from '../types/schemas.js';
import { ShellExecuteParamsSchema } from '../types/schemas.js';
import type { TerminalOperateParams } from '../types/quick-schemas.js';
import { TerminalOperateParamsSchema } from '../types/quick-schemas.js';

export type ConfirmationPayload = Readonly<{
  label: string;
  value: string;
}>;

export type ConfirmationDetail = Readonly<{
  label: string;
  value: string;
}>;

export type ExecutionConfirmation = Readonly<{
  summary: string;
  payloads: readonly ConfirmationPayload[];
  details: readonly ConfirmationDetail[];
}>;

export type ShellExecuteIntent = Readonly<{
  kind: 'shell_execute';
  parameters: ShellExecuteParams;
  confirmation: ExecutionConfirmation;
}>;

export type TerminalInputIntent = Readonly<{
  source: 'command' | 'input';
  value: string;
  send: boolean;
  execute: boolean;
  controlCodes: boolean;
  sendTo?: string;
}>;

export type TerminalOperateIntent = Readonly<{
  kind: 'terminal_operate';
  parameters: TerminalOperateParams;
  target: Readonly<
    | { kind: 'new' }
    | {
        kind: 'existing';
        terminalId: string;
      }
  >;
  input?: TerminalInputIntent;
  confirmation: ExecutionConfirmation;
}>;

function freezeParameters<T extends object>(parameters: T): T {
  for (const value of Object.values(parameters)) {
    if (value !== null && typeof value === 'object') {
      Object.freeze(value);
    }
  }
  return Object.freeze(parameters);
}

function formatEnvironment(environment: Record<string, string>): string {
  return JSON.stringify(environment, null, 2);
}

function buildShellConfirmation(parameters: ShellExecuteParams): ExecutionConfirmation {
  const payloads: ConfirmationPayload[] = [
    { label: 'Shell command (exact text)', value: parameters.command },
  ];
  const details: ConfirmationDetail[] = [
    {
      label: 'Working directory',
      value: parameters.working_directory ?? 'Runtime default (not specified by this request)',
    },
    { label: 'Execution mode', value: parameters.execution_mode },
    { label: 'Create interactive terminal', value: String(parameters.create_terminal) },
  ];

  if (parameters.input_data !== undefined) {
    payloads.push({ label: 'Standard input (exact text)', value: parameters.input_data });
  } else if (parameters.input_output_id !== undefined) {
    details.push({
      label: 'Standard input',
      value: `Contents referenced by output ID ${parameters.input_output_id} (resolved at execution time)`,
    });
  } else {
    details.push({ label: 'Standard input', value: 'None' });
  }

  if (parameters.environment_variables !== undefined) {
    payloads.push({
      label: 'Environment overrides (exact values)',
      value: formatEnvironment(parameters.environment_variables),
    });
  } else {
    details.push({ label: 'Environment overrides', value: 'None' });
  }

  return Object.freeze({
    summary: 'Execute the following shell request?',
    payloads: Object.freeze(payloads),
    details: Object.freeze(details),
  });
}

function resolveTerminalInput(
  parameters: TerminalOperateParams,
  target: TerminalOperateIntent['target']
): TerminalInputIntent | undefined {
  const source = parameters.input !== undefined ? 'input' : parameters.command !== undefined ? 'command' : undefined;
  if (source === undefined) {
    return undefined;
  }

  const value = parameters[source];
  if (value === undefined) {
    return undefined;
  }

  const intent: TerminalInputIntent = {
    source,
    value,
    send: value.length > 0,
    execute: parameters.execute,
    controlCodes: parameters.control_codes,
    ...(parameters.send_to !== undefined ? { sendTo: parameters.send_to } : {}),
  };

  if (target.kind === 'new' && source !== 'command') {
    throw new Error('New terminal input must use command');
  }

  return Object.freeze(intent);
}

function buildTerminalConfirmation(
  parameters: TerminalOperateParams,
  target: TerminalOperateIntent['target'],
  input: TerminalInputIntent | undefined
): ExecutionConfirmation {
  const payloads: ConfirmationPayload[] = [];
  const details: ConfirmationDetail[] = [
    {
      label: 'Terminal target',
      value: target.kind === 'new' ? 'Create a new terminal' : `Existing terminal ${target.terminalId}`,
    },
  ];

  if (input !== undefined) {
    payloads.push({
      label: `Terminal ${input.source} (exact text)`,
      value: input.value,
    });
    details.push(
      { label: 'Input will be sent', value: String(input.send) },
      { label: 'Append Enter (carriage return)', value: String(input.execute) },
      { label: 'Interpret control-code escapes', value: String(input.controlCodes) },
      { label: 'Program guard target', value: input.sendTo ?? 'None' }
    );
  } else {
    details.push({ label: 'Terminal input', value: 'None' });
  }

  if (target.kind === 'new') {
    details.push(
      { label: 'Shell type', value: parameters.shell_type },
      {
        label: 'Working directory',
        value: parameters.working_directory ?? 'Runtime default (not specified by this request)',
      },
      {
        label: 'Initial dimensions',
        value: `${parameters.dimensions.width} x ${parameters.dimensions.height}`,
      }
    );
    if (parameters.environment_variables !== undefined) {
      payloads.push({
        label: 'Terminal environment overrides (exact values)',
        value: formatEnvironment(parameters.environment_variables),
      });
    } else {
      details.push({ label: 'Terminal environment overrides', value: 'None' });
    }
  } else if (parameters.dimensions !== undefined) {
    details.push({
      label: 'Requested terminal dimensions',
      value: `${parameters.dimensions.width} x ${parameters.dimensions.height}`,
    });
  }

  details.push({ label: 'Retrieve output', value: String(parameters.get_output) });

  return Object.freeze({
    summary: 'Perform the following terminal operation?',
    payloads: Object.freeze(payloads),
    details: Object.freeze(details),
  });
}

export function resolveShellExecuteIntent(rawParameters: unknown): ShellExecuteIntent {
  const parameters = freezeParameters(ShellExecuteParamsSchema.parse(rawParameters));
  return Object.freeze({
    kind: 'shell_execute',
    parameters,
    confirmation: buildShellConfirmation(parameters),
  });
}

export function resolveTerminalOperateIntent(rawParameters: unknown): TerminalOperateIntent {
  const parameters = freezeParameters(TerminalOperateParamsSchema.parse(rawParameters ?? {}));
  const target: TerminalOperateIntent['target'] = parameters.terminal_id
    ? Object.freeze({ kind: 'existing', terminalId: parameters.terminal_id })
    : Object.freeze({ kind: 'new' });
  const input = resolveTerminalInput(parameters, target);

  return Object.freeze({
    kind: 'terminal_operate',
    parameters,
    target,
    ...(input !== undefined ? { input } : {}),
    confirmation: buildTerminalConfirmation(parameters, target, input),
  });
}
