export function startHeartbeat(
  write: (event: string, data: unknown) => void,
  intervalMs = 10000
): NodeJS.Timeout {
  return setInterval(() => {
    write('heartbeat', { t: Date.now() });
  }, intervalMs);
}
