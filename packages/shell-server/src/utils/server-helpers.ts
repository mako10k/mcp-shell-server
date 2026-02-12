import type http from 'http';

export function listenServer(server: http.Server, host: string, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.once('error', reject);
  });
}

export function closeServer(server: http.Server): Promise<void> {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}
