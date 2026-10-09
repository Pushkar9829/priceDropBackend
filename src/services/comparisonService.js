const { Product, StoreProduct, PriceHistory } = require('../models');
const AppError = require('../utils/AppError');
const { round2 } = require('../utils/helpers');

/**
 * Build price comparison from latest stored prices (not live HTTP fetches).
 */
const getComparison = async (productId) => {
  const product = await Product.exists({ _id: productId, isActive: true });
  if (!product) {
    throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  }

  const all = await StoreProduct.find({
    productId,
    isActive: true,
  })
    .populate('storeId', 'name slug logo domain isActive')
    .lean();

  // Listings from disabled/deleted stores are hidden entirely
  const storeProducts = all.filter((sp) => sp.storeId && sp.storeId.isActive !== false);

  const available = storeProducts.filter(
    (sp) => sp.availability !== 'OUT_OF_STOCK' && sp.currentPrice > 0
  );

  const listings = storeProducts.map((sp) => ({
    storeProductId: sp._id,
    store: sp.storeId
      ? {
          id: sp.storeId._id,
          name: sp.storeId.name,
          slug: sp.storeId.slug,
          logo: sp.storeId.logo,
          domain: sp.storeId.domain,
        }
      : null,
    title: sp.title,
    currentPrice: sp.currentPrice,
    previousPrice: sp.previousPrice,
    mrp: sp.mrp,
    discount: sp.discount,
    currency: sp.currency,
    availability: sp.availability,
    rating: sp.rating,
    reviewCount: sp.reviewCount,
    productUrl: sp.productUrl,
    affiliateUrl: sp.affiliateUrl,
    seller: sp.seller,
    lastCheckedAt: sp.lastCheckedAt,
    nextCheckAt: sp.nextCheckAt,
    scrapeStatus: sp.scrapeStatus,
    isBestPrice: false,
  }));
  listings.forEach((l) => {
    l.savingsVsMrp = l.mrp && l.mrp > l.currentPrice ? round2(l.mrp - l.currentPrice) : null;
  });

  const prices = available.map((sp) => sp.currentPrice);
  const lowestPrice = prices.length ? Math.min(...prices) : null;
  const highestPrice = prices.length ? Math.max(...prices) : null;
  const priceDifference =
    lowestPrice != null && highestPrice != null ? round2(highestPrice - lowestPrice) : null;
  const percentageDifference =
    lowestPrice && highestPrice && lowestPrice > 0
      ? round2(((highestPrice - lowestPrice) / lowestPrice) * 100)
      : null;

  let bestStore = null;
  listings.forEach((listing) => {
    if (
      listing.availability !== 'OUT_OF_STOCK' &&
      listing.currentPrice === lowestPrice
    ) {
      listing.isBestPrice = true;
      if (!bestStore) {
        bestStore = listing.store;
      }
    }
  });

  listings.sort((a, b) => {
    if (a.availability === 'OUT_OF_STOCK' && b.availability !== 'OUT_OF_STOCK') return 1;
    if (b.availability === 'OUT_OF_STOCK' && a.availability !== 'OUT_OF_STOCK') return -1;
    return a.currentPrice - b.currentPrice;
  });

  return {
    productId,
    listings,
    summary: {
      lowestPrice,
      highestPrice,
      priceDifference,
      percentageDifference,
      bestStore,
      availableCount: available.length,
      totalListings: listings.length,
      lastCheckedAt: listings.reduce((m, l) => (l.lastCheckedAt && (!m || l.lastCheckedAt > m) ? l.lastCheckedAt : m), null),
      nextCheckAt: listings.reduce((m, l) => (l.nextCheckAt && (!m || l.nextCheckAt < m) ? l.nextCheckAt : m), null),
      currency: 'INR',
    },
  };
};

/**
 * Price history stats for a product (optionally filtered by store product).
 */
const getPriceHistory = async (productId, { storeProductId, days = 90 } = {}) => {
  days = Math.min(730, Math.max(1, parseInt(days, 10) || 90));
  const since = new Date();
  since.setDate(since.getDate() - days);

  const filter = {
    productId,
    recordedAt: { $gte: since },
  };
  if (storeProductId) filter.storeProductId = storeProductId;

  const history = await PriceHistory.find(filter)
    .sort({ recordedAt: -1 })
    .populate('storeId', 'name slug')
    .limit(5000)
    .lean()
    .then((rows) => rows.reverse()); // newest 5000 kept, returned oldest → newest

  const prices = history.map((h) => h.newPrice).filter((p) => p > 0);
  const stats = {
    currentPrice: prices.length ? prices[prices.length - 1] : null,
    lowestHistoricalPrice: prices.length ? Math.min(...prices) : null,
    highestHistoricalPrice: prices.length ? Math.max(...prices) : null,
    averagePrice: prices.length
      ? round2(prices.reduce((a, b) => a + b, 0) / prices.length)
      : null,
    dataPoints: history.length,
    days,
  };

  return { history, stats };
};

module.exports = { getComparison, getPriceHistory };
