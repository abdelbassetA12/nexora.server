import http from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { ensureCatalog } from './database/catalog';
import { connectDatabase, disconnectDatabase } from './database/connect';
import { attachSocketServer } from './sockets';
import { logger } from './utils/logger';

async function main() {
  await connectDatabase();
  await ensureCatalog();

  const server = http.createServer(createApp());
  const io = attachSocketServer(server); // single instance; add the Socket.IO Redis adapter before scaling horizontally
  server.listen(env.PORT, () => logger.info(`NEXORA API listening on :${env.PORT}`));

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    io.close();
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
