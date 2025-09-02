import { RemoteHttpClient } from './remote-http-client.js';

export interface RemoteExecStartRequest {
  execution_id?: string;
  command: string;
  working_directory?: string;
  timeout_seconds?: number;
  capture_stderr?: boolean;
  max_output_size?: number;
  safety_evaluation?: unknown;
}

export interface RemoteExecStartResponse {
  execution_id: string;
  status: string;
}

export class RemoteProcessService {
  constructor(private client = new RemoteHttpClient()) {}

  start(req: RemoteExecStartRequest): Promise<RemoteExecStartResponse> {
    return this.client.post('/v1/exec', req);
  }

  get(id: string): Promise<unknown> {
    return this.client.get(`/v1/exec/${encodeURIComponent(id)}`);
  }
}
