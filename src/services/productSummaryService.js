const mongoose = require('mongoose');
const { Product, StoreProduct, Store } = require('../models');
const logger = require('../utils/logger');

const NO_PRICE_SORT = 1e12;

const EMPTY = {
  lowestPrice: null,
  sortPrice: NO_PRICE_SORT,
  highestPrice: null,
  mrp: null,
  discountPercent: null,
  storeCount: 0,
  inStockCount: 0,
  bestStoreProductId: null,
  lastCheckedAt: null,
};

let activeStoreCache = { at: 0, ids: null };
/** Active store ids, cached briefly (store toggles call invalidateStores()). */
const activeStoreIds = async () => {
  // Short TTL: another instance's store toggle is picked up within 15s
  if (activeStoreCache.ids && Date.now() - activeStoreCache.at < 15_000) return activeStoreCache.ids;
  const ids = await Store.find({ isActive: true }).distinct('_id');
  activeStoreCache = { at: Date.now(), ids };
  return ids;
};
const invalidateStores = () => {
  activeStoreCache = { at: 0, ids: null };
};

/**
 * Recompute priceSummary for the given products from their active listings (one aggregation,
 * one bulkWrite). Call after any change that affects a listing's price, stock or visibility.
 */
const refreshProductSummaries = async (productIds) => {
  const ids = [...new Set((productIds || []).filter(Boolean).map(String))];
  if (!ids.length) return 0;

  const storeIds = await activeStoreIds();
  const rows = await StoreProduct.aggregate([
    {
      $match: {
        productId: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
        isActive: true,
        storeId: { $in: storeIds },
      },
    },
    {
      $addFields: {
        inStock: { $and: [{ $ne: ['$availability', 'OUT_OF_STOCK'] }, { $gt: ['$currentPrice', 0] }] },
      },
    },
    // Cheapest in-stock listing first so $first picks the best offer
    { $sort: { inStock: -1, currentPrice: 1 } },
    {
      $group: {
        _id: '$productId',
        storeCount: { $sum: 1 },
        inStockCount: { $sum: { $cond: ['$inStock', 1, 0] } },
        lowestPrice: { $min: { $cond: ['$inStock', '$currentPrice', null] } },
        highestPrice: { $max: { $cond: ['$inStock', '$currentPrice', null] } },
        mrp: { $max: '$mrp' },
        best: { $first: { id: '$_id', inStock: '$inStock' } },
        lastCheckedAt: { $max: '$lastCheckedAt' },
      },
    },
  ]);

  const byId = new Map(rows.map((r) => [String(r._id), r]));
  const now = new Date();
  const ops = ids.map((id) => {
    const r = byId.get(id);
    const summary = r
      ? {
          lowestPrice: r.lowestPrice ?? null,
          sortPrice: r.lowestPrice ?? NO_PRICE_SORT,
          highestPrice: r.highestPrice ?? null,
          mrp: r.mrp ?? null,
          discountPercent:
            r.lowestPrice && r.mrp && r.mrp > r.lowestPrice
              ? Math.round(((r.mrp - r.lowestPrice) / r.mrp) * 100)
              : null,
          storeCount: r.storeCount,
          inStockCount: r.inStockCount,
          bestStoreProductId: r.best?.inStock ? r.best.id : null,
          lastCheckedAt: r.lastCheckedAt ?? null,
        }
      : EMPTY;
    return {
      updateOne: {
        filter: { _id: id },
        // timestamps:false — a price refresh must not reorder "recently updated" catalog sorts
        update: { $set: { priceSummary: { ...summary, updatedAt: now } } },
        timestamps: false,
      },
    };
  });

  await Product.bulkWrite(ops, { ordered: false });
  return ops.length;
};

/** Products with listings in a store (store enabled/disabled). Runs in chunks. */
const refreshForStore = async (storeId) => {
  invalidateStores();
  const productIds = await StoreProduct.distinct('productId', { storeId });
  for (let i = 0; i < productIds.length; i += 500) {
    await refreshProductSummaries(productIds.slice(i, i + 500));
  }
  return productIds.length;
};

/**
 * Backfill products whose summary was never computed (first boot after upgrade, imports).
 * Pass { all: true } to rebuild everything.
 */
const backfillSummaries = async ({ all = false, chunk = 500 } = {}) => {
  const filter = all ? {} : { 'priceSummary.updatedAt': null };
  let total = 0;
  let lastId = null;
  // Keyset pagination keeps memory flat on large catalogs
  for (;;) {
    const page = await Product.find(lastId ? { ...filter, _id: { $gt: lastId } } : filter)
      .sort({ _id: 1 })
      .limit(chunk)
      .select('_id')
      .lean();
    if (!page.length) break;
    total += await refreshProductSummaries(page.map((p) => p._id));
    lastId = page[page.length - 1]._id;
  }
  if (total) logger.info('Product price summaries backfilled', { total, all });
  return total;
};

module.exports = {
  refreshProductSummaries,
  refreshForStore,
  backfillSummaries,
  invalidateStores,
  activeStoreIds,
};
