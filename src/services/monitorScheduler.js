const config = require('../config');
const { PriceAlert, Watchlist, Product, ALERT_STATUS } = require('../models');

/**
 * Adaptive check scheduling.
 *
 *  HOT    — product has an active alert or is on someone's watchlist → checked most often
 *  NORMAL — visible product, nobody tracking it
 *  COLD   — product hidden from the catalog → rare background checks
 *
 * Failures back off exponentially (capped) so dead URLs stop eating scraper capacity.
 * ±10% jitter spreads load so listings imported together don't all fall due together.
 */
const MIN = 60 * 1000;

const tierInterval = (tier) => {
  const m = config.monitor;
  if (tier === 'HOT') return m.hotIntervalMin * MIN;
  if (tier === 'COLD') return m.coldIntervalMin * MIN;
  return m.normalIntervalMin * MIN;
};

const jitter = (ms) => Math.round(ms * (0.9 + Math.random() * 0.2));

/**
 * @param {{ tier: string, consecutiveFailureCount?: number }} listing
 * @param {Date} [from]
 */
const computeNextCheckAt = ({ tier, consecutiveFailureCount = 0 }, from = new Date()) => {
  let interval = tierInterval(tier);
  if (consecutiveFailureCount > 0) {
    interval = Math.min(interval * 2 ** Math.min(consecutiveFailureCount, 10), config.monitor.maxBackoffMin * MIN);
  }
  return new Date(from.getTime() + jitter(interval));
};

/**
 * Resolve demand tier for a set of product ids in 3 indexed queries.
 * @returns {Promise<Map<string, 'HOT'|'NORMAL'|'COLD'>>}
 */
const resolveTiers = async (productIds) => {
  const ids = [...new Set(productIds.map(String))];
  const [alerted, watched, hidden] = await Promise.all([
    PriceAlert.distinct('productId', {
      productId: { $in: ids },
      status: { $in: [ALERT_STATUS.ACTIVE, ALERT_STATUS.TRIGGERED] },
    }),
    Watchlist.distinct('productId', { productId: { $in: ids } }),
    Product.distinct('_id', { _id: { $in: ids }, isActive: false }),
  ]);
  const hot = new Set([...alerted, ...watched].map(String));
  const cold = new Set(hidden.map(String));
  return new Map(ids.map((id) => [id, hot.has(id) ? 'HOT' : cold.has(id) ? 'COLD' : 'NORMAL']));
};

module.exports = { computeNextCheckAt, resolveTiers, tierInterval };
