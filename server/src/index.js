import { getConfig } from './config.js';
import { connectDb } from './db/connect.js';
import { createApp } from './app.js';
import { recoverInterruptedJobs } from './jobs/kitJobs.js';
import { log } from './lib/logger.js';

const cfg = getConfig();
if (cfg.isProd && cfg.jwtSecret === 'dev-only-insecure-secret') {
  log.error('JWT_SECRET must be set in production.');
  process.exit(1);
}

await connectDb(cfg.mongoUri);
await recoverInterruptedJobs();
createApp().listen(cfg.port, () => log.info(`API listening on :${cfg.port}`));
