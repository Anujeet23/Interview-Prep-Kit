import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { User } from '../db/models/User.js';
import { AppError } from '../lib/errors.js';
import { issueSession, clearSession, requireAuth } from './session.js';
import { parseBody } from '../routes/validate.js';

const Credentials = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(200),
});

const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts. Wait a few minutes and try again.' } } });

export const authRouter = Router();

authRouter.post('/register', limiter, async (req, res) => {
  const { email, password } = parseBody(Credentials, req.body);
  if (await User.exists({ email })) throw new AppError('EMAIL_TAKEN', 'An account with this email already exists. Sign in instead.', { status: 409 });
  const user = await User.create({ email, passwordHash: await bcrypt.hash(password, 11) });
  issueSession(res, user);
  res.status(201).json({ user: { id: user._id, email: user.email } });
});

authRouter.post('/login', limiter, async (req, res) => {
  const { email, password } = parseBody(Credentials.extend({ password: z.string().min(1).max(200) }), req.body);
  const user = await User.findOne({ email });
  // Same error either way so the endpoint doesn't reveal which emails have accounts.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new AppError('INVALID_CREDENTIALS', 'Email or password is incorrect.', { status: 401 });
  issueSession(res, user);
  res.json({ user: { id: user._id, email: user.email } });
});

authRouter.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));
