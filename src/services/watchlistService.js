const AppError = require('../utils/AppError');
const { Watchlist, Product } = require('../models');

// Lazy require avoids a circular import with productService
const enrichWithPrices = (products) => require('./productService').enrichWithPrices(products);

const addToWatchlist = async (userId, productId) => {
  const product = await Product.findById(productId);
  if (!product || !product.isActive) {
    throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  }

  // Watched products are checked every 30 min — cap so one account can't flood the scraper
  const MAX_WATCHLIST = 500;
  if (!(await Watchlist.exists({ userId, productId })) && (await Watchlist.countDocuments({ userId })) >= MAX_WATCHLIST) {
    throw new AppError(`Your watchlist is full (${MAX_WATCHLIST} items). Remove some to add more.`, 400, 'WATCHLIST_LIMIT');
  }
  require('./priceMonitoringService').promoteToHot(productId).catch(() => {});
  // Upsert keeps double-clicks / concurrent requests idempotent
  return Watchlist.findOneAndUpdate(
    { userId, productId },
    { $setOnInsert: { userId, productId, addedPrice: product.priceSummary?.lowestPrice ?? null } },
    { upsert: true, new: true }
  );
};

const removeFromWatchlist = async (userId, productId) => {
  const item = await Watchlist.findOneAndDelete({ userId, productId });
  if (!item) {
    throw new AppError('Product not in watchlist', 404, 'NOT_IN_WATCHLIST');
  }
  return item;
};

const getWatchlist = async (userId) => {
  const items = await Watchlist.find({ userId }).sort({ createdAt: -1 }).lean();
  if (!items.length) return [];

  const products = await Product.find({
    _id: { $in: items.map((i) => i.productId) },
    isActive: true,
  }).lean();
  // Single aggregation instead of one StoreProduct query per watchlist row
  const enriched = await enrichWithPrices(products);
  const byId = new Map(enriched.map((p) => [String(p.id), p]));

  return items
    .map((item) => {
      const product = byId.get(String(item.productId));
      if (!product) return null;
      const change =
        item.addedPrice && product.lowestPrice ? product.lowestPrice - item.addedPrice : null;
      return { id: item._id, addedAt: item.createdAt, addedPrice: item.addedPrice ?? null, priceChange: change, product };
    })
    .filter(Boolean);
};

module.exports = { addToWatchlist, removeFromWatchlist, getWatchlist };
