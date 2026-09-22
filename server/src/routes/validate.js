import { AppError } from '../lib/errors.js';

export function parseBody(schema, body) {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    throw new AppError('VALIDATION_FAILED', first?.message && !/^(Expected|Required|Invalid)/.test(first.message) ? first.message : `Invalid ${first?.path.join('.') || 'request'}: ${first?.message}`, {
      status: 400,
      details: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}
