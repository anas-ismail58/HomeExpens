import type { RequestHandler } from 'express';
import { sendError } from '../utils/apiResponse';

export const notFound: RequestHandler = (req, res) => {
  sendError(res, 404, `Route not found: ${req.method} ${req.originalUrl}`, [], 'NOT_FOUND');
};
