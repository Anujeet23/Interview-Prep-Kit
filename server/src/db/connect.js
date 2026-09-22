import mongoose from 'mongoose';
import { log } from '../lib/logger.js';

export async function connectDb(uri) {
  if (!uri) throw new Error('MONGODB_URI is not set. See .env.example.');
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  log.info('MongoDB connected');
  return mongoose.connection;
}
