import mongoose from 'mongoose';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export async function connectDatabase(uri = env.MONGODB_URI): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { maxPoolSize: 20, serverSelectionTimeoutMS: 10_000 });
  logger.info('MongoDB connected');
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
