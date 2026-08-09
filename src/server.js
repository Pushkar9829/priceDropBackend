require('dotenv').config();

const app = require('./app');
const config = require('./config');
const connectDB = require('./config/db');
const { startJobs } = require('./jobs');
const logger = require('./utils/logger');

const start = async () => {
  await connectDB();

  const server = app.listen(config.port, () => {
    logger.info('Server started', {
      port: config.port,
      env: config.env,
      apiPrefix: config.apiPrefix,
    });
  });

  startJobs();

  const shutdown = async (signal) => {
    logger.info(`${signal} received, shutting down`);
    try {
      const { closeBrowser } = require('./integrations/stores/base/browserClient');
      await closeBrowser();
    } catch {
      // ignore if playwright never started
    }
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

start().catch((err) => {
  logger.error('Failed to start server', { error: err.message });
  process.exit(1);
});
