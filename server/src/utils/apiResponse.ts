import type { Response } from 'express';
import type { FieldError } from './AppError';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  message = 'OK',
  statusCode = 200,
  meta?: PaginationMeta,
) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    ...(meta ? { meta } : {}),
  });
}

export function sendError(
  res: Response,
  statusCode: number,
  message: string,
  errors: FieldError[] = [],
  code?: string,
) {
  return res.status(statusCode).json({
    success: false,
    message,
    ...(code ? { code } : {}),
    errors,
    data: null,
  });
}
