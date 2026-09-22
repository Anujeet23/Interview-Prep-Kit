const quiet = () => process.env.LOG_LEVEL === 'silent';
export const log = {
  info: (...a) => !quiet() && console.log('[info]', ...a),
  warn: (...a) => !quiet() && console.warn('[warn]', ...a),
  error: (...a) => !quiet() && console.error('[error]', ...a),
};
