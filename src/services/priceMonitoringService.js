const config = require('../config');
const logger = require('../utils/logger');
const { runWithConcurrency } = require('../utils/concurrency');
const { withStoreProductLock } = require('../utils/monitoringLock');
const distributedLock = require('../utils/distributedLock');
const { StoreProduct, Deal, SCRAPE_STATUS } = require('../models');
const { isValidPrice } = require('../integrations/stores/base/validator');
const storeIntegrationService = require('./storeIntegrationService');
const { computeNextCheckAt, resolveTiers } = require('./monitorScheduler');
const { activeStoreIds, refreshProductSummaries } = require('./productSummaryService');
const { analyzePriceChange, getHistoricalLowest, recordPriceChange } = require('./priceChangeRecorder');

const LOCK_NAME = 'price-monitor';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Live progress of the run on this instance (exposed to the admin dashboard). */
let currentRun = null;
let lastRun = null;
let stopping = false;

const getRunState = () => ({ currentRun, lastRun });
let runPromise = null;
const requestStop = () => {
  stopping = true;
};
/** Graceful shutdown: stop picking work, wait (bounded) for in-flight checks + lock release. */
const waitForIdle = async (ms = 8000) => {
  stopping = true;
  if (!runPromise) return;
  await Promise.race([runPromise.catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
};

const scheduleFields = (storeProduct, tier, now = new Date()) => ({
  monitorTier: tier,
  nextCheckAt: computeNextCheckAt({ tier, consecutiveFailureCount: storeProduct.consecutiveFailureCount }, now),
});

/**
 * PRICE SAFETY: a failed fetch never touches currentPrice — only health + schedule fields.
 */
const markFetchFailure = async (storeProduct, err, scrapeStatus, tier) => {
  const now = new Date();
  storeProduct.lastCheckedAt = now;
  storeProduct.lastFailedFetchAt = now;
  storeProduct.scrapeStatus = scrapeStatus;
  storeProduct.consecutiveFailureCount = (storeProduct.consecutiveFailureCount || 0) + 1;
  storeProduct.lastError = String(err.message || err).slice(0, 500);
  storeProduct.lastCheckStatus = 'FAILED';
  storeProduct.lastCheckError = storeProduct.lastError;
  Object.assign(storeProduct, scheduleFields(storeProduct, tier, now));
  await storeProduct.save();

  logger.warn('Price check failed', {
    storeProductId: storeProduct._id,
    scrapeStatus,
    failures: storeProduct.consecutiveFailureCount,
    nextCheckAt: storeProduct.nextCheckAt,
    error: storeProduct.lastError,
  });
};

const markFetchSuccess = (storeProduct, tier, now) => {
  storeProduct.lastCheckedAt = now;
  storeProduct.lastSuccessfulFetchAt = now;
  storeProduct.scrapeStatus = SCRAPE_STATUS.SUCCESS;
  storeProduct.consecutiveFailureCount = 0;
  storeProduct.lastError = null;
  storeProduct.lastCheckStatus = 'SUCCESS';
  storeProduct.lastCheckError = null;
  Object.assign(storeProduct, scheduleFields(storeProduct, tier, now));
};

const failureStatus = (err) => {
  if (err.code === 'PRODUCT_NOT_FOUND') return SCRAPE_STATUS.PRODUCT_NOT_FOUND;
  if (err.code === 'TIMEOUT' || err.code === 'NETWORK' || err.code === 'BLOCKED') {
    return SCRAPE_STATUS.TEMPORARILY_UNAVAILABLE;
  }
  return SCRAPE_STATUS.FAILED;
};

const checkStoreProductUnlocked = async (storeProductId, { tier } = {}) => {
  const storeProduct = await StoreProduct.findById(storeProductId);
  if (!storeProduct || !storeProduct.isActive) return { skipped: true, reason: 'inactive' };

  const resolvedTier = tier || (await resolveTiers([storeProduct.productId])).get(String(storeProduct.productId));

  let fetched;
  try {
    fetched = await storeIntegrationService.fetchPriceForStoreProduct(storeProduct);
  } catch (err) {
    await markFetchFailure(storeProduct, err, failureStatus(err), resolvedTier);
    return { failed: true, error: err.message, storeProductId: storeProduct._id };
  }

  const now = new Date();
  const previousPrice = storeProduct.currentPrice;
  const previousAvailability = storeProduct.availability;
  const newAvailability = fetched.availability || previousAvailability;

  if (!isValidPrice(fetched.price)) {
    if (newAvailability !== 'OUT_OF_STOCK') {
      await markFetchFailure(storeProduct, new Error(`Invalid price received: ${fetched.price}`), SCRAPE_STATUS.FAILED, resolvedTier);
      return { failed: true, error: 'invalid_price', storeProductId: storeProduct._id };
    }
    // Out of stock with no price shown: keep the last price, record the stock change
    markFetchSuccess(storeProduct, resolvedTier, now);
    storeProduct.scrapeStatus = SCRAPE_STATUS.OUT_OF_STOCK;
    storeProduct.availability = 'OUT_OF_STOCK';
    await storeProduct.save();
    const changed = previousAvailability !== 'OUT_OF_STOCK';
    if (changed) {
      await recordPriceChange({
        storeProduct,
        previousPrice,
        newPrice: previousPrice,
        priceChanged: false,
        availabilityChanged: true,
        newAvailability: 'OUT_OF_STOCK',
      });
    } else {
      await refreshProductSummaries([storeProduct.productId]);
    }
    return { changed, outOfStock: true, storeProductId: storeProduct._id };
  }

  const newPrice = fetched.price;
  markFetchSuccess(storeProduct, resolvedTier, now);
  if (newAvailability === 'OUT_OF_STOCK') storeProduct.scrapeStatus = SCRAPE_STATUS.OUT_OF_STOCK;

  const priceChanged = previousPrice !== newPrice;
  const availabilityChanged = previousAvailability !== newAvailability;

  if (isValidPrice(fetched.mrp)) storeProduct.mrp = fetched.mrp;
  if (priceChanged) {
    storeProduct.previousPrice = previousPrice;
    storeProduct.currentPrice = newPrice;
  }
  if (storeProduct.mrp) {
    storeProduct.discount = storeProduct.mrp > newPrice ? Math.round(((storeProduct.mrp - newPrice) / storeProduct.mrp) * 100) : 0;
  }
  if (availabilityChanged) storeProduct.availability = newAvailability;
  await storeProduct.save();

  if (!priceChanged && !availabilityChanged) {
    // Cheap self-healing: keeps lastCheckedAt fresh and catches up summary/alerts if a
    // previous change's side effects failed midway (DB blip during recordPriceChange)
    await refreshProductSummaries([storeProduct.productId]);
    await require('./alertService')
      .evaluateAlertsForProduct(storeProduct.productId)
      .catch((err) => logger.warn('Alert re-check failed', { error: err.message }));
    return { changed: false, storeProductId: storeProduct._id, price: newPrice };
  }

  const { analysis, historyRecord } = await recordPriceChange({
    storeProduct,
    previousPrice,
    newPrice,
    priceChanged,
    availabilityChanged,
    newAvailability,
  });

  return {
    changed: true,
    storeProductId: storeProduct._id,
    previousPrice: priceChanged ? previousPrice : undefined,
    newPrice,
    analysis,
    historyId: historyRecord?._id,
  };
};

/** Check one listing now (admin refresh / retry). Serialized per listing. */
const checkStoreProduct = (storeProductId, opts) =>
  withStoreProductLock(storeProductId, () => checkStoreProductUnlocked(storeProductId, opts));

/** Deactivate deals past their expiry (runs every tick, cheap indexed update). */
const expireDeals = async () => {
  const res = await Deal.updateMany({ isActive: true, expiresAt: { $ne: null, $lte: new Date() } }, { $set: { isActive: false } });
  if (res.modifiedCount) logger.info('Expired deals deactivated', { count: res.modifiedCount });
  return res.modifiedCount || 0;
};

/**
 * One scheduler tick: check listings whose nextCheckAt is due, most overdue first.
 *
 * - Guarded by a MongoDB lease lock → only one instance runs at a time; a crashed run's
 *   lease expires on its own.
 * - Stores run in parallel; each store gets limited concurrency + a polite delay.
 * - Stops picking new work once the tick's time budget is spent, so ticks never pile up.
 *
 * @param {{ limit?: number, storeId?: string, force?: boolean }} opts
 *   force — ignore schedules and check every active listing (admin "refresh all")
 */
const runPriceMonitoring = (opts = {}) => {
  const p = runPriceMonitoringInner(opts);
  runPromise = p;
  p.finally(() => {
    if (runPromise === p) runPromise = null;
  }).catch(() => {});
  return p;
};

const runPriceMonitoringInner = async ({ limit = config.monitor.batchSize, storeId = null, force = false } = {}) => {
  const budget = force ? Math.max(config.monitor.tickBudgetMs, 30 * 60 * 1000) : config.monitor.tickBudgetMs;
  const lock = await distributedLock.acquire(LOCK_NAME, budget + 2 * 60 * 1000, { startedAt: new Date() });
  if (!lock) {
    logger.info('Price monitoring skipped — another run holds the lock');
    return { total: 0, checked: 0, changed: 0, failed: 0, unchanged: 0, skipped: true, reason: 'locked' };
  }

  const startedAt = Date.now();
  stopping = false;
  // Heartbeat: checks that start near the end of the budget can run several minutes
  // (timeouts x retries), so keep the lease alive until this run actually finishes.
  const heartbeat = setInterval(() => lock.renew(2 * 60 * 1000).catch(() => {}), 60 * 1000);
  heartbeat.unref?.();
  try {
    await expireDeals();

    const now = new Date();
    const filter = { isActive: true, storeId: { $in: await activeStoreIds() } };
    if (storeId) filter.storeId = storeId;
    if (!force) filter.$or = [{ nextCheckAt: null }, { nextCheckAt: { $lte: now } }];

    const due = await StoreProduct.find(filter)
      .sort({ nextCheckAt: 1, lastCheckedAt: 1 })
      .limit(force ? Math.max(limit, 5000) : limit)
      .select('_id productId storeId')
      .lean();

    const summary = { total: due.length, checked: 0, changed: 0, failed: 0, unchanged: 0, skippedForBudget: 0 };
    currentRun = { startedAt: new Date(startedAt), force, ...summary, byStore: {} };
    if (!due.length) return summary;

    logger.info('Price monitoring started', { due: due.length, force });
    const tiers = await resolveTiers(due.map((d) => d.productId));

    const byStore = new Map();
    for (const d of due) {
      const key = String(d.storeId);
      if (!byStore.has(key)) byStore.set(key, []);
      byStore.get(key).push(d);
    }

    await Promise.all(
      [...byStore.entries()].map(([sid, items]) => {
        currentRun.byStore[sid] = { total: items.length, done: 0 };
        return runWithConcurrency(items, config.monitor.perStoreConcurrency, async (item) => {
          if (stopping || Date.now() - startedAt > budget) {
            summary.skippedForBudget += 1;
            return;
          }
          let result;
          try {
            result = await checkStoreProduct(item._id, { tier: tiers.get(String(item.productId)) });
          } catch (err) {
            logger.error('Unexpected error checking listing', { storeProductId: item._id, error: err.message });
            result = { failed: true };
          }
          if (result?.failed) summary.failed += 1;
          else if (result?.changed) {
            summary.changed += 1;
            summary.checked += 1;
          } else if (!result?.skipped) {
            summary.unchanged += 1;
            summary.checked += 1;
          }
          currentRun.byStore[sid].done += 1;
          Object.assign(currentRun, summary);
          await sleep(config.monitor.perStoreDelayMs);
        });
      })
    );

    // Keep the lease alive for anything slow at the tail, then report
    await lock.renew(60 * 1000);
    summary.durationMs = Date.now() - startedAt;
    logger.info('Price monitoring completed', summary);
    return summary;
  } finally {
    clearInterval(heartbeat);
    lastRun = currentRun ? { ...currentRun, finishedAt: new Date() } : lastRun;
    currentRun = null;
    await lock.release().catch(() => {});
    // Free Chromium memory between ticks; deferred automatically if an import is mid-flight
    try {
      await require('../integrations/stores/base/browserClient').closeBrowser();
    } catch {
      /* playwright never started */
    }
  }
};

/** Schedule snapshot for the admin dashboard. */
const getScheduleStats = async () => {
  const now = new Date();
  const hour = new Date(now.getTime() + 60 * 60 * 1000);
  const storeIds = await activeStoreIds();
  const base = { isActive: true, storeId: { $in: storeIds } };
  const [dueNow, dueNextHour, tiers] = await Promise.all([
    StoreProduct.countDocuments({ ...base, $or: [{ nextCheckAt: null }, { nextCheckAt: { $lte: now } }] }),
    StoreProduct.countDocuments({ ...base, nextCheckAt: { $gt: now, $lte: hour } }),
    StoreProduct.aggregate([{ $match: base }, { $group: { _id: '$monitorTier', n: { $sum: 1 } } }]),
  ]);
  return {
    dueNow,
    dueNextHour,
    tiers: Object.fromEntries(tiers.map((t) => [t._id || 'NORMAL', t.n])),
    intervalsMin: {
      HOT: config.monitor.hotIntervalMin,
      NORMAL: config.monitor.normalIntervalMin,
      COLD: config.monitor.coldIntervalMin,
    },
    tickCron: config.cron.priceMonitor,
  };
};

/**
 * Pull listings of a product forward in the queue (e.g. a shopper opened a stale product page).
 * Cheap, non-blocking — the next tick does the actual scraping.
 */
const prioritizeProduct = (productId, staleMin = config.monitor.staleOnViewMin) => {
  const staleBefore = new Date(Date.now() - staleMin * 60 * 1000);
  return StoreProduct.updateMany(
    {
      productId,
      isActive: true,
      consecutiveFailureCount: { $lt: 3 },
      $and: [
        { $or: [{ lastCheckedAt: null }, { lastCheckedAt: { $lt: staleBefore } }] },
        { $or: [{ nextCheckAt: null }, { nextCheckAt: { $gt: new Date() } }] },
      ],
    },
    { $set: { nextCheckAt: new Date() } },
    { timestamps: false }
  );
};

/**
 * A product just gained a watcher/alert: bring its listings onto the HOT cadence now
 * instead of waiting for their (possibly hours-away) NORMAL/COLD check.
 */
const promoteToHot = (productId) => {
  const soon = computeNextCheckAt({ tier: 'HOT' });
  return StoreProduct.updateMany(
    // null = already due now; only pull in listings scheduled later than the HOT cadence
    { productId, isActive: true, nextCheckAt: { $gt: soon } },
    { $set: { nextCheckAt: soon, monitorTier: 'HOT' } },
    { timestamps: false }
  );
};

module.exports = {
  promoteToHot,
  analyzePriceChange,
  checkStoreProduct,
  runPriceMonitoring,
  getHistoricalLowest,
  markFetchFailure,
  expireDeals,
  getRunState,
  getScheduleStats,
  prioritizeProduct,
  requestStop,
  waitForIdle,
};
