import fs from 'fs/promises';
import net from 'net';
import path from 'path';

const pidFile = process.env['MCP_SHELL_MCP_CHILD_PID_FILE'];
const socketPath = process.env['MCP_SHELL_MCP_SOCKET'];
let server = null;

const shutdown = async () => {
  if (server) {
    await new Promise((resolve) => server.close(() => resolve()));
    server = null;
  }

  if (socketPath) {
    try {
      await fs.rm(socketPath, { force: true });
    } catch {
      // Ignore cleanup errors.
    }
  }

  if (pidFile) {
    try {
      await fs.rm(pidFile, { force: true });
    } catch {
      // Ignore cleanup errors.
    }
  }
  process.exit(0);
};

if (socketPath) {
  await fs.mkdir(path.dirname(socketPath), { recursive: true });
  try {
    const stat = await fs.stat(socketPath);
    if (stat.isSocket()) {
      await fs.rm(socketPath, { force: true });
    }
  } catch {
    // Ignore missing socket.
  }

  server = net.createServer((socket) => {
    socket.on('error', () => {});
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });
  await fs.chmod(socketPath, 0o600);
}

if (pidFile) {
  await fs.writeFile(pidFile, String(process.pid), 'utf-8');
}

process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});

setInterval(() => {}, 1000);
