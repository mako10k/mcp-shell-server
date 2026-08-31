#!/usr/bin/env node

/**
 * MCP Shell Server - terminal_operate control-code request examples.
 *
 * The script prints request payloads; it does not start the MCP server or send
 * terminal input. Replace the placeholder terminal ID with one returned by a
 * terminal_operate creation request.
 */

const terminalId = 'terminal_123';

const creationRequest = {
  tool: 'terminal_operate',
  arguments: {
    command: 'printf "terminal ready\\n"',
    shell_type: 'bash',
    get_output: true,
  },
};

const controlCodeRequests = {
  interruptProcess: {
    tool: 'terminal_operate',
    arguments: {
      terminal_id: terminalId,
      input: '^C',
      execute: false,
      control_codes: true,
      get_output: true,
    },
  },
  clearScreen: {
    tool: 'terminal_operate',
    arguments: {
      terminal_id: terminalId,
      input: '^L',
      execute: false,
      control_codes: true,
      get_output: true,
    },
  },
  escapeKey: {
    tool: 'terminal_operate',
    arguments: {
      terminal_id: terminalId,
      input: '\\x1b',
      execute: false,
      control_codes: true,
      get_output: true,
    },
  },
  tabKey: {
    tool: 'terminal_operate',
    arguments: {
      terminal_id: terminalId,
      input: '\\t',
      execute: false,
      control_codes: true,
      get_output: true,
    },
  },
};

console.log('Create a host terminal:');
console.log(JSON.stringify(creationRequest, null, 2));
console.log();
console.log('Control-code requests for the returned terminal_id:');

for (const [name, request] of Object.entries(controlCodeRequests)) {
  console.log(`\n${name}:`);
  console.log(JSON.stringify(request, null, 2));
}

console.log('\nControl-code input and terminal creation are unavailable in restrictive mode.');
console.log('The public terminal_operate schema does not expose raw byte input.');
