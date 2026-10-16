const cron = require('node-cron');
const config = require('../config');
const logger = require('../utils/logger');
const priceMonitoringService = require('../services/priceMonitoringService');
const { backfillSummaries } = require('../services/productSummaryService');

const tasks = [];

/** One scheduler tick — also callable from POST /internal/monitor/tick. */
const tick = async () => {
  try {
    const summary = await priceMonitoringService.runPriceMonitoring();
    if (summary.skipped) logger.debug('Monitor tick skipped', { reason: summary.reason });
    return summary;
  } catch (err) {
    logger.error('Monitor tick failed', { error: err.message });
    return { failed: true, error: err.message };
  }
};

/**
 * Background jobs:
 *  - startup: backfill product price summaries that were never computed (upgrade / imports)
 *  - every PRICE_MONITOR_CRON (default 5 min): check listings whose nextCheckAt is due
 */
const startJobs = () => {
  require('../utils/dataIntegrity')
    .ensureDataIntegrity()
    .catch((err) => logger.error('Data integrity check failed', { error: err.message }));
  backfillSummaries().catch((err) => logger.error('Summary backfill failed', { error: err.message }));

  if (!config.cron.enabled) {
    logger.info('Cron jobs disabled via ENABLE_CRON=false (use POST /internal/monitor/tick)');
    return;
  }

  if (!cron.validate(config.cron.priceMonitor)) {
    logger.error('Invalid PRICE_MONITOR_CRON expression', { expression: config.cron.priceMonitor });
    return;
  }

  tasks.push(cron.schedule(config.cron.priceMonitor, tick));

  // Daily Cuelinks stores + coupons refresh — runs only if enabled in Admin → Affiliate settings
  // and an API key is set there (or in CUELINKS_API_KEY)
  if (cron.validate(config.cuelinks.syncCron)) {
    tasks.push(
      cron.schedule(config.cuelinks.syncCron, () =>
        require('../services/cuelinksService')
          .scheduledSync()
          .catch((err) => logger.error('Affiliate sync failed', { error: err.message }))
      )
    );
    logger.info('Affiliate sync scheduled', { cron: config.cuelinks.syncCron });
  }
  logger.info('Price monitor scheduled', {
    tick: config.cron.priceMonitor,
    intervalsMin: {
      hot: config.monitor.hotIntervalMin,
      normal: config.monitor.normalIntervalMin,
      cold: config.monitor.coldIntervalMin,
    },
  });
};

const stopJobs = () => {
  priceMonitoringService.requestStop();
  while (tasks.length) tasks.pop().stop();
};

module.exports = { startJobs, stopJobs, tick };
