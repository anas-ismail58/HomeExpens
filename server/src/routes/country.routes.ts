import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { actor, requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { addCountry, COUNTRY_CURRENCY, listCountries, removeCountry, setDefaultCountry } from '../services/country.service';
import { sendSuccess } from '../utils/apiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { idParamSchema } from '../validators/finance.validator';

const addSchema = z.object({ code: z.enum(Object.keys(COUNTRY_CURRENCY) as [string, ...string[]]) });

/** The countries the family spends in; everyone sees them, the father manages them. */
export const countriesRouter = Router();
countriesRouter.use(requireAuth);
countriesRouter.get('/', asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await listCountries(actor(req)))));
countriesRouter.post('/', validate({ body: addSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await addCountry(actor(req), req.body.code), 'Country added', 201)));
countriesRouter.put('/:id/default', validate({ params: idParamSchema }), asyncHandler(async (req: Request, res: Response) => sendSuccess(res, await setDefaultCountry(actor(req), String(req.params.id)), 'Default country set')));
countriesRouter.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await removeCountry(actor(req), String(req.params.id));
    sendSuccess(res, null, 'Country removed');
  }),
);
