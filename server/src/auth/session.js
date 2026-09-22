import jwt from 'jsonwebtoken';
import { getConfig } from '../config.js';
import { AppError } from '../lib/errors.js';

export const COOKIE = 'ipk_session';

export function issueSession(res, user) {
  const cfg = getConfig();
  const token = jwt.sign({ sub: String(user._id), email: user.email }, cfg.jwtSecret, { expiresIn: `${cfg.sessionDays}d` });
  res.cookie(COOKIE, token, {
    httpOnly: true, // not readable from JavaScript, so an XSS bug can't steal it
    sameSite: 'lax', // not sent on cross-site POSTs (CSRF)
    secure: cfg.isProd,
    maxAge: cfg.sessionDays * 86_400_000,
    path: '/',
  });
}

export function clearSession(res) {
  const cfg = getConfig();
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: cfg.isProd, path: '/' });
}

/** Rejects the request unless it carries a valid, unexpired session. */
export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return next(new AppError('UNAUTHENTICATED', 'Sign in to continue.', { status: 401 }));
  try {
    const payload = jwt.verify(token, getConfig().jwtSecret);
    req.user = { id: payload.sub, email: payload.email };
    return next();
  } catch (e) {
    clearSession(res);
    const expired = e.name === 'TokenExpiredError';
    return next(new AppError(expired ? 'SESSION_EXPIRED' : 'INVALID_SESSION', expired ? 'Your session has expired. Sign in again.' : 'Your session is not valid. Sign in again.', { status: 401 }));
  }
}

/**
 * CSRF defence in depth: for state-changing requests, a browser-sent Origin header must be
 * one of ours. (SameSite=Lax cookies and JSON-only bodies already block the classic attack.)
 */
export function checkOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  const allowed = getConfig().appOrigins;
  const self = `${req.protocol}://${req.get('host')}`;
  if (origin === self || allowed.includes(origin)) return next();
  return next(new AppError('BAD_ORIGIN', 'Request origin not allowed.', { status: 403 }));
}
