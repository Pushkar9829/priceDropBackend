require('dotenv').config();

const mongoose = require('mongoose');
const app = require('./app');
const config = require('./config');
const connectDB = require('./config/db');
const { startJobs, stopJobs } = require('./jobs');
const logger = require('./utils/logger');

const start = async () => {
  const { problems, warnings } = config.validate();
  warnings.forEach((w) => logger.warn('Configuration warning', { warning: w }));
  if (problems.length) {
    problems.forEach((p) => logger.error('Configuration error', { problem: p }));
    process.exit(1);
  }

  await connectDB();

  const server = require('http').createServer(app);
  // Keep idle connections open longer than typical proxy/LB idle timeouts (60s): Node's 5s
  // default makes proxies reuse sockets the server already closed (random 502s) and forces
  // every returning visitor to open a new connection under load.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  // Larger accept queue so bursts of new connections queue instead of being refused
  server.listen({ port: config.port, backlog: 2048 }, () => {
    logger.info('Server started', {
      port: config.port,
      env: config.env,
      apiPrefix: config.apiPrefix,
    });
  });

  // In cluster mode only the designated worker runs background jobs
  if (process.env.RUN_JOBS !== '0') startJobs();

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, shutting down`);

    // Force exit if graceful shutdown hangs (e.g. long scrape in flight)
    setTimeout(() => process.exit(1), 10000).unref();

    stopJobs();
    // Let the current monitor run finish its in-flight checks and release its lease,
    // otherwise the next deploy waits for the lock to expire
    await require('./services/priceMonitoringService').waitForIdle(7000);
    try {
      const { closeBrowser } = require('./integrations/stores/base/browserClient');
      await closeBrowser({ force: true });
    } catch {
      // ignore if playwright never started
    }
    server.close(async () => {
      await mongoose.connection.close().catch(() => {});
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
  });
});

start().catch((err) => {
  logger.error('Failed to start server', { error: err.message });
  process.exit(1);
});
