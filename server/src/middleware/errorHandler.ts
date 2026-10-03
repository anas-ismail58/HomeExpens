import type { ErrorRequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError';
import { sendError } from '../utils/apiResponse';
import { isProd } from '../config/env';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    sendError(res, err.statusCode, err.message, err.errors, err.code);
    return;
  }

  if (err instanceof ZodError) {
    sendError(
      res,
      422,
      'Validation failed',
      err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      'VALIDATION_ERROR',
    );
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': {
        const target = (err.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
        sendError(res, 409, `A record with this ${target} already exists`, [], 'CONFLICT');
        return;
      }
      case 'P2025':
        sendError(res, 404, 'Resource not found', [], 'NOT_FOUND');
        return;
      case 'P2003':
        sendError(res, 409, 'Related record is in use or does not exist', [], 'FOREIGN_KEY');
        return;
    }
  }

  // Malformed JSON body
  if (err instanceof SyntaxError && 'body' in err) {
    sendError(res, 400, 'Malformed JSON body', [], 'BAD_JSON');
    return;
  }

  console.error(err);
  sendError(
    res,
    500,
    isProd ? 'Internal server error' : (err as Error)?.message ?? 'Internal server error',
    [],
    'INTERNAL_ERROR',
  );
};
