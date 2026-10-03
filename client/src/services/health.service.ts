import { api, type ApiSuccess } from './api';

export interface HealthStatus {
  status: 'ok';
  database: 'connected';
  latencyMs: number;
  uptimeSec: number;
  timestamp: string;
}

export async function getHealth(): Promise<HealthStatus> {
  const { data } = await api.get<ApiSuccess<HealthStatus>>('/health');
  return data.data;
}
