const config = require('../config');
const logger = require('../utils/logger');
const { runWithConcurrency } = require('../utils/concurrency');
const {
  tryAcquireBatchLock,
  releaseBatchLock,
  withStoreProductLock,
} = require('../utils/monitoringLock');
const {
  StoreProduct,
  SCRAPE_STATUS,
} = require('../models');
const { isValidPrice } = require('../integrations/stores/base/validator');
const storeIntegrationService = require('./storeIntegrationService');
const {
  analyzePriceChange,
  getHistoricalLowest,
  recordPriceChange,
} = require('./priceChangeRecorder');

/**
 * PRICE SAFETY: never overwrite a valid price with null/0/invalid.
 * Only update scrape health metadata on failure.
 */
const markFetchFailure = async (storeProduct, err, scrapeStatus = SCRAPE_STATUS.FAILED) => {
  const now = new Date();
  storeProduct.lastCheckedAt = now;
  storeProduct.lastFailedFetchAt = now;
  storeProduct.scrapeStatus = scrapeStatus;
  storeProduct.consecutiveFailureCount = (storeProduct.consecutiveFailureCount || 0) + 1;
  storeProduct.lastError = err.message || String(err);
  storeProduct.lastCheckStatus = 'FAILED';
  storeProduct.lastCheckError = storeProduct.lastError;
  await storeProduct.save();

  logger.error('Store integration failed', {
    storeProductId: storeProduct._id,
    storeId: storeProduct.storeId,
    scrapeStatus,
    consecutiveFailureCount: storeProduct.consecutiveFailureCount,
    error: storeProduct.lastError,
    preservedPrice: storeProduct.currentPrice,
  });
};

const markFetchSuccess = (storeProduct) => {
  const now = new Date();
  storeProduct.lastCheckedAt = now;
  storeProduct.lastSuccessfulFetchAt = now;
  storeProduct.scrapeStatus = SCRAPE_STATUS.SUCCESS;
  storeProduct.consecutiveFailureCount = 0;
  storeProduct.lastError = null;
  storeProduct.lastCheckStatus = 'SUCCESS';
  storeProduct.lastCheckError = null;
};

const checkStoreProductUnlocked = async (storeProductId) => {
  const storeProduct = await StoreProduct.findById(storeProductId);
  if (!storeProduct || !storeProduct.isActive) {
    return { skipped: true, reason: 'inactive' };
  }

  logger.debug('Product checked — fetch started', {
    storeProductId: storeProduct._id,
    externalProductId: storeProduct.externalProductId,
  });

  let fetched;
  try {
    fetched = await storeIntegrationService.fetchPriceForStoreProduct(storeProduct);
  } catch (err) {
    const status =
      err.code === 'PRODUCT_NOT_FOUND'
        ? SCRAPE_STATUS.PRODUCT_NOT_FOUND
        : err.code === 'TIMEOUT' || err.code === 'NETWORK'
          ? SCRAPE_STATUS.TEMPORARILY_UNAVAILABLE
          : SCRAPE_STATUS.FAILED;
    await markFetchFailure(storeProduct, err, status);
    return {
      skipped: false,
      failed: true,
      error: err.message,
      preservedPrice: storeProduct.currentPrice,
    };
  }

  const newAvailability = fetched.availability || storeProduct.availability;

  if (!isValidPrice(fetched.price)) {
    if (newAvailability === 'OUT_OF_STOCK') {
      const wasOos = storeProduct.availability === 'OUT_OF_STOCK';
      const now = new Date();
      storeProduct.lastCheckedAt = now;
      storeProduct.lastSuccessfulFetchAt = now;
      storeProduct.availability = 'OUT_OF_STOCK';
      storeProduct.scrapeStatus = SCRAPE_STATUS.OUT_OF_STOCK;
      storeProduct.consecutiveFailureCount = 0;
      storeProduct.lastError = null;
      storeProduct.lastCheckStatus = 'SUCCESS';
      storeProduct.lastCheckError = null;
      await storeProduct.save();
      logger.info('Product marked out of stock (price unavailable)', {
        storeProductId: storeProduct._id,
        preservedPrice: storeProduct.currentPrice,
      });
      return {
        skipped: false,
        changed: !wasOos,
        outOfStock: true,
        storeProductId: storeProduct._id,
        preservedPrice: storeProduct.currentPrice,
      };
    }

    await markFetchFailure(
      storeProduct,
      new Error(`Invalid price received: ${fetched.price}`),
      SCRAPE_STATUS.FAILED
    );
    return {
      skipped: false,
      failed: true,
      error: 'invalid_price',
      preservedPrice: storeProduct.currentPrice,
    };
  }

  const previousPrice = storeProduct.currentPrice;
  const newPrice = fetched.price;
  const previousAvailability = storeProduct.availability;

  markFetchSuccess(storeProduct);
  if (newAvailability === 'OUT_OF_STOCK') {
    storeProduct.scrapeStatus = SCRAPE_STATUS.OUT_OF_STOCK;
  }

  const priceChanged = previousPrice !== newPrice;
  const availabilityChanged = previousAvailability !== newAvailability;

  if (!priceChanged && !availabilityChanged) {
    await storeProduct.save();
    logger.debug('Product checked — price unchanged', {
      storeProductId: storeProduct._id,
      price: newPrice,
    });
    return {
      skipped: false,
      changed: false,
      storeProductId: storeProduct._id,
      price: newPrice,
    };
  }

  if (priceChanged) {
    storeProduct.previousPrice = previousPrice;
    storeProduct.currentPrice = newPrice;
    if (isValidPrice(fetched.mrp)) {
      storeProduct.mrp = fetched.mrp;
      storeProduct.discount = Math.round(((fetched.mrp - newPrice) / fetched.mrp) * 100);
    }
  }

  if (availabilityChanged) {
    storeProduct.availability = newAvailability;
  }

  await storeProduct.save();

  const { analysis, historyRecord } = await recordPriceChange({
    storeProduct,
    previousPrice,
    newPrice,
    priceChanged,
    availabilityChanged,
    newAvailability,
  });

  return {
    skipped: false,
    changed: true,
    storeProductId: storeProduct._id,
    previousPrice: priceChanged ? previousPrice : undefined,
    newPrice,
    analysis,
    historyId: historyRecord?._id,
  };
};

/**
 * Process a single store product with a per-product lock.
 */
const checkStoreProduct = async (storeProductId) =>
  withStoreProductLock(storeProductId, () => checkStoreProductUnlocked(storeProductId));

/**
 * Run full monitoring cycle with controlled concurrency + batch lock.
 */
const runPriceMonitoring = async ({
  forceAll = false,
  limit = 500,
  storeId = null,
} = {}) => {
  if (!tryAcquireBatchLock()) {
    logger.warn('Price monitoring skipped — another batch run is in progress');
    return {
      total: 0,
      checked: 0,
      changed: 0,
      failed: 0,
      unchanged: 0,
      skipped: true,
      reason: 'batch_lock',
    };
  }

  try {
    logger.info('Price monitoring started', { storeId: storeId || 'all' });

    const filter = { isActive: true };
    if (storeId) filter.storeId = storeId;
    if (!forceAll) {
      const threshold = new Date(Date.now() - 50 * 60 * 1000);
      filter.$or = [{ lastCheckedAt: null }, { lastCheckedAt: { $lt: threshold } }];
    }

    const storeProducts = await StoreProduct.find(filter)
      .select('_id')
      .limit(limit)
      .lean();

    const summary = {
      total: storeProducts.length,
      checked: 0,
      changed: 0,
      failed: 0,
      unchanged: 0,
    };

    const results = await runWithConcurrency(
      storeProducts,
      config.scraper.concurrency,
      async ({ _id }) => {
        try {
          return await checkStoreProduct(_id);
        } catch (err) {
          logger.error('Unexpected error checking store product', {
            storeProductId: _id,
            error: err.message,
          });
          return { failed: true, error: err.message };
        }
      }
    );

    for (const result of results) {
      if (!result || result.error) {
        summary.failed += 1;
        continue;
      }
      if (result.failed) summary.failed += 1;
      else if (result.changed) {
        summary.changed += 1;
        summary.checked += 1;
      } else if (!result.skipped) {
        summary.unchanged += 1;
        summary.checked += 1;
      }
    }

    logger.info('Price monitoring completed', summary);
    return summary;
  } finally {
    releaseBatchLock();
  }
};

module.exports = {
  analyzePriceChange,
  checkStoreProduct,
  runPriceMonitoring,
  getHistoricalLowest,
  markFetchFailure,
};
