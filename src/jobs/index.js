const cron = require('node-cron');
const config = require('../config');
const logger = require('../utils/logger');
const priceMonitoringService = require('../services/priceMonitoringService');

/**
 * Price monitoring cron — runs every hour by default.
 * Batch lock lives in priceMonitoringService (shared with admin refresh).
 */
const startJobs = () => {
  if (!config.cron.enabled) {
    logger.info('Cron jobs disabled via ENABLE_CRON=false');
    return;
  }

  if (!cron.validate(config.cron.priceMonitor)) {
    logger.error('Invalid PRICE_MONITOR_CRON expression', {
      expression: config.cron.priceMonitor,
    });
    return;
  }

  cron.schedule(config.cron.priceMonitor, async () => {
    logger.info('Cron: price monitoring job triggered');
    try {
      const summary = await priceMonitoringService.runPriceMonitoring();
      if (summary.skipped) {
        logger.warn('Cron: price monitoring skipped', { reason: summary.reason });
      }
    } catch (err) {
      logger.error('Cron: price monitoring job failed', { error: err.message });
    }
  });

  logger.info('Cron jobs scheduled', {
    priceMonitor: config.cron.priceMonitor,
  });
};

module.exports = { startJobs };
