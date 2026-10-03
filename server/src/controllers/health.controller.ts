import type { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { sendSuccess, sendError } from '../utils/apiResponse';

export async function getHealth(_req: Request, res: Response) {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return sendSuccess(res, {
      status: 'ok',
      database: 'connected',
      latencyMs: Date.now() - started,
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch {
    return sendError(res, 503, 'Database unavailable', [], 'DB_UNAVAILABLE');
  }
}
