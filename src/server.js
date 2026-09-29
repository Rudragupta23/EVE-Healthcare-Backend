'use strict';

const config = require('./config');
const logger = require('./utils/logger');
const { sequelize } = require('./models');
const { createApp } = require('./app');

async function start() {
  await sequelize.authenticate();
  const server = createApp().listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, `API listening on http://localhost:${config.port} (docs at /docs)`);
  });

  // Finish in-flight requests before exiting (e.g. on docker stop).
  const shutdown = (signal) => {
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      await sequelize.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
