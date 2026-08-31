#!/usr/bin/env node

/**
 * MCP Shell Server - terminal_operate Program Guard request examples.
 *
 * The script prints request payloads; it does not inspect processes or send
 * terminal input. Replace the placeholder terminal ID and PID with values from
 * the target host terminal.
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

const guardRequests = {
  processName: {
    tool: 'terminal_operate',
    arguments: {
      terminal_id: terminalId,
      input: 'echo "Hello from bash"',
      execute: true,
      send_to: 'bash',
      get_output: true,
    },
  },
  exactPid: {
    tool: 'terminal_operate',
    arguments: {
      terminal_id: terminalId,
      input: '^C',
      execute: false,
      control_codes: true,
      send_to: 'pid:12345',
      get_output: true,
    },
  },
  sessionLeader: {
    tool: 'terminal_operate',
    arguments: {
      terminal_id: terminalId,
      input: 'logout',
      execute: true,
      send_to: 'sessionleader:',
      get_output: true,
    },
  },
  executablePath: {
    tool: 'terminal_operate',
    arguments: {
      terminal_id: terminalId,
      input: 'pwd',
      execute: true,
      send_to: '/usr/bin/bash',
      get_output: true,
    },
  },
};

console.log('Create a host terminal:');
console.log(JSON.stringify(creationRequest, null, 2));
console.log();
console.log('Program Guard requests for the returned terminal_id:');

for (const [name, request] of Object.entries(guardRequests)) {
  console.log(`\n${name}:`);
  console.log(JSON.stringify(request, null, 2));
}

console.log('\nProgram Guard is a point-in-time foreground-process check.');
console.log('It is not an OS isolation boundary and is unavailable in restrictive mode.');
