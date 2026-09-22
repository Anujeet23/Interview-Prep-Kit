import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { getConfig } from './config.js';
import { authRouter } from './auth/routes.js';
import { kitsRouter } from './routes/kits.js';
import { checkOrigin } from './auth/session.js';
import { AppError } from './lib/errors.js';
import { log } from './lib/logger.js';

export function createApp() {
  const cfg = getConfig();
  const app = express();
  app.set('trust proxy', 1); // behind Render/Vercel proxies: needed for secure cookies and rate limiting
  app.disable('x-powered-by');
  app.use(helmet());
  // The frontend normally proxies /api through Next.js (same origin), so CORS is only
  // needed if someone calls the API directly from the frontend's origin.
  app.use(cors({ origin: cfg.appOrigins, credentials: true }));
  app.use(express.json({ limit: '600kb' }));
  app.use(cookieParser());
  app.use(checkOrigin);

  app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use('/api/auth', authRouter);
  app.use('/api/kits', kitsRouter);

  app.use((req, res, next) => next(new AppError('NOT_FOUND', `No route for ${req.method} ${req.path}`, { status: 404 })));

  // Every error leaves the API in one shape: { error: { code, message, details? } }
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') err = new AppError('PAYLOAD_TOO_LARGE', 'That request is too large.', { status: 413 });
    else if (err.type === 'entity.parse.failed') err = new AppError('BAD_JSON', 'The request body is not valid JSON.', { status: 400 });
    else if (err.name === 'CastError') err = new AppError('NOT_FOUND', 'Not found.', { status: 404 });
    const status = err.status || 500;
    if (status >= 500) log.error(err);
    res.status(status).json({
      error: { code: err.code && typeof err.code === 'string' ? err.code : 'INTERNAL', message: status >= 500 && !err.code ? 'Something went wrong on our side.' : err.message, details: err.details },
    });
  });
  return app;
}
