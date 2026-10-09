const { StoreProduct, PriceHistory } = require('../models');
const { backfillSummaries } = require('../services/productSummaryService');
const logger = require('./logger');

/**
 * One-off upgrade helper for data created before adaptive monitoring:
 *  1. lowestEverPrice / highestEverPrice on each listing from its price history
 *  2. priceSummary on every product
 * Idempotent — safe to re-run.
 */
const backfillMonitoringData = async () => {
  const extremes = await PriceHistory.aggregate([
    { $match: { newPrice: { $gt: 0 } } },
    { $group: { _id: '$storeProductId', low: { $min: '$newPrice' }, high: { $max: '$newPrice' } } },
  ]);
  const ops = extremes.map((e) => ({
    updateOne: {
      filter: { _id: e._id },
      update: { $set: { lowestEverPrice: e.low, highestEverPrice: e.high } },
      timestamps: false,
    },
  }));
  for (let i = 0; i < ops.length; i += 1000) {
    await StoreProduct.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
  }
  const products = await backfillSummaries({ all: true });
  logger.info('Monitoring backfill complete', { listings: ops.length, products });
  return { listings: ops.length, products };
};

module.exports = { backfillMonitoringData };
