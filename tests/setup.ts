// Environment must be defined before any application module (which validates env on import) is loaded.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://placeholder/overridden-in-setup';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-test-access-secret-0123456789';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-test-refresh-secret-0123456789';
process.env.LOG_LEVEL = 'silent';
process.env.EMAIL_PROVIDER = 'dev';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll } from 'vitest';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  // Isolated in-memory database; never touches a real deployment.
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await mongoose.syncIndexes();
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
