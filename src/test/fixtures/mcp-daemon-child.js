import fs from 'fs/promises';

const pidFile = process.env['MCP_SHELL_MCP_CHILD_PID_FILE'];

const shutdown = async () => {
  if (pidFile) {
    try {
      await fs.rm(pidFile, { force: true });
    } catch {
      // Ignore cleanup errors.
    }
  }
  process.exit(0);
};

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
