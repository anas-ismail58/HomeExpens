import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { env, isProd } from './config/env';
import { apiRouter } from './routes';
import { apiLimiter } from './middleware/rateLimit';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // behind Render / reverse proxy
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: isProd
        ? {
            directives: {
              defaultSrc: ["'self'"],
              imgSrc: ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'],
              styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
              fontSrc: ["'self'", 'https://fonts.gstatic.com'],
              connectSrc: ["'self'"],
            },
          }
        : false,
    }),
  );
  app.use(
    cors({
      origin: (origin, callback) => {
        const allowed = !origin || origin === env.CLIENT_URL || (!isProd && origin === 'http://localhost:8081');
        callback(null, allowed);
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  if (env.NODE_ENV !== 'test') app.use(morgan(isProd ? 'combined' : 'dev'));

  app.use('/api', apiLimiter, apiRouter);
  app.use('/api', notFound);

  // Serve the React build from the same origin in production
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (isProd && fs.existsSync(clientDist)) {
    // Hashed build assets: cache forever. Everything else (favicon, init script): revalidate.
    app.use('/assets', express.static(path.join(clientDist, 'assets'), { maxAge: '1y', immutable: true }));
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
