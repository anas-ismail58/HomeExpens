import { Router } from 'express';
import { getExchangeRates } from '../services/rates.service';
import { sendSuccess } from '../utils/apiResponse';
import { asyncHandler } from '../utils/asyncHandler';

export const ratesRouter = Router();

ratesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
    sendSuccess(res, await getExchangeRates());
  }),
);
