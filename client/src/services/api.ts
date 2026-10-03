import axios, { AxiosError } from 'axios';

export interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
  meta?: { page: number; limit: number; total: number; totalPages: number };
}

export interface ApiFailure {
  success: false;
  message: string;
  code?: string;
  errors: Array<{ field: string; message: string }>;
  data: null;
}

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true, // refresh-token cookie (Phase 6)
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

/** Normalizes any thrown error into the ApiFailure shape. */
export function toApiFailure(error: unknown): ApiFailure {
  if (error instanceof AxiosError) {
    const body = error.response?.data as Partial<ApiFailure> | undefined;
    if (body && body.success === false) {
      return { success: false, message: body.message ?? 'Error', code: body.code, errors: body.errors ?? [], data: null };
    }
    return {
      success: false,
      message: error.code === 'ECONNABORTED' ? 'Request timed out' : error.message,
      code: error.code,
      errors: [],
      data: null,
    };
  }
  return { success: false, message: 'Unexpected error', errors: [], data: null };
}
