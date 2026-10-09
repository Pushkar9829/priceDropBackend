const { Deal, PriceAlert } = require('../models');
const logger = require('./logger');

/**
 * Startup repair for invariants enforced by partial unique indexes.
 * Existing duplicates would make those index builds fail, so collapse them first
 * (keep the newest), then ensure the indexes exist. Idempotent.
 */
const keepNewest = async (Model, match, groupKey, deactivate) => {
  const dups = await Model.aggregate([
    { $match: match },
    { $sort: { updatedAt: -1, _id: -1 } },
    { $group: { _id: groupKey, ids: { $push: '$_id' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  const extra = dups.flatMap((d) => d.ids.slice(1));
  if (extra.length) await Model.updateMany({ _id: { $in: extra } }, { $set: deactivate });
  return extra.length;
};

const ensureDataIntegrity = async () => {
  const deals = await keepNewest(Deal, { isActive: true }, '$storeProductId', { isActive: false });
  const alerts = await keepNewest(
    PriceAlert,
    { status: { $in: ['ACTIVE', 'TRIGGERED', 'PAUSED'] } },
    { u: '$userId', p: '$productId', s: '$storeProductId' },
    { status: 'CANCELLED' }
  );
  if (deals || alerts) logger.warn('Collapsed duplicate records', { deals, alerts });
  await Promise.all([Deal.createIndexes(), PriceAlert.createIndexes()]);
};

module.exports = { ensureDataIntegrity };
