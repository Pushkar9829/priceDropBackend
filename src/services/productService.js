const { Product, StoreProduct, Brand, Watchlist, PriceAlert } = require('../models');
const { createSlug, normalizeTitle } = require('../utils/helpers');
const { escapeRegex } = require('../utils/regex');
const AppError = require('../utils/AppError');
const matchingService = require('./matchingService');
const storeIntegrationService = require('./storeIntegrationService');
const logger = require('../utils/logger');
const config = require('../config');
const { isValidPrice } = require('../integrations/stores/base/validator');
const { applyFetchedPrice, recordPriceChange } = require('./priceChangeRecorder');
const { refreshProductSummaries } = require('./productSummaryService');
const { computeNextCheckAt } = require('./monitorScheduler');
const { withStoreProductLock } = require('../utils/monitoringLock');

const ensureUniqueSlug = async (base) => {
  let slug = createSlug(base) || `product-${Date.now()}`;
  let n = 0;
  while (await Product.exists({ slug })) {
    n += 1;
    slug = `${createSlug(base)}-${n}`;
  }
  return slug;
};

const toCard = (product) => {
  const ps = product.priceSummary || {};
  return {
    id: product._id,
    title: product.title,
    brand: product.brand,
    category: product.category,
    subCategory: product.subCategory,
    images: product.images,
    slug: product.slug,
    storeCount: ps.storeCount || 0,
    inStockCount: ps.inStockCount || 0,
    lowestPrice: ps.lowestPrice ?? null,
    highestPrice: ps.highestPrice ?? null,
    mrp: ps.mrp ?? null,
    discountPercent: ps.discountPercent ?? null,
    lastCheckedAt: ps.lastCheckedAt ?? null,
    currency: 'INR',
  };
};

/**
 * Shape products for catalog cards using the denormalized priceSummary (no listing
 * aggregation at request time). Products whose summary was never built are computed once.
 */
const enrichWithPrices = async (products) => {
  if (!products.length) return [];
  const missing = products.filter((p) => !p.priceSummary?.updatedAt).map((p) => p._id);
  if (missing.length) {
    await refreshProductSummaries(missing);
    const fresh = await Product.find({ _id: { $in: missing } }).select('priceSummary').lean();
    const byId = new Map(fresh.map((f) => [String(f._id), f.priceSummary]));
    products = products.map((p) => (byId.has(String(p._id)) ? { ...p, priceSummary: byId.get(String(p._id)) } : p));
  }
  return products.map(toCard);
};

/**
 * Build a Mongo filter for catalog search (DB-first — no live scrape).
 */
const buildSearchFilter = async (q) => {
  const query = String(q || '').trim();
  if (!query) return { isActive: true };

  const slug = createSlug(query);
  const brandDoc = await Brand.findOne({
    isActive: true,
    $or: [{ slug }, { name: new RegExp(`^${escapeRegex(query)}$`, 'i') }],
  })
    .select('name')
    .lean();

  if (brandDoc?.name) {
    const hasBrandProducts = await Product.exists({
      isActive: true,
      brand: brandDoc.name,
    });
    if (hasBrandProducts) {
      return { isActive: true, brand: brandDoc.name };
    }
  }

  const exactBrandHit = await Product.exists({
    isActive: true,
    brand: new RegExp(`^${escapeRegex(query)}$`, 'i'),
  });

  if (exactBrandHit) {
    return { isActive: true, brand: new RegExp(`^${escapeRegex(query)}$`, 'i') };
  }

  const tokens = query.split(/\s+/).filter(Boolean).slice(0, 6);
  if (tokens.length >= 2) {
    return {
      isActive: true,
      $and: tokens.map((t) => ({
        $or: [
          { title: new RegExp(escapeRegex(t), 'i') },
          { brand: new RegExp(escapeRegex(t), 'i') },
          { normalizedTitle: new RegExp(escapeRegex(normalizeTitle(t)), 'i') },
        ],
      })),
      __preferText: query,
    };
  }

  return {
    isActive: true,
    __preferText: query,
    $or: [
      { brand: new RegExp(escapeRegex(query), 'i') },
      { title: new RegExp(escapeRegex(query), 'i') },
      { normalizedTitle: new RegExp(escapeRegex(normalizeTitle(query)), 'i') },
    ],
  };
};

/**
 * Upsert a canonical product from store search/detail data.
 * Pass { storeId, externalProductId } so an already-known listing keeps its product link
 * and matching never merges into a product that already has a listing from that store.
 */
const upsertCanonicalProduct = async (incoming, { storeId, externalProductId } = {}) => {
  if (storeId && externalProductId) {
    const known = await StoreProduct.findOne({ storeId, externalProductId })
      .select('productId')
      .lean();
    if (known) {
      const product = await Product.findById(known.productId);
      if (product) return { product, created: false, confidence: 1 };
    }
  }

  const payload = {
    title: incoming.title,
    brand: incoming.brand || '',
    category: incoming.category || 'General',
    subCategory: incoming.subCategory || '',
    description: incoming.description || '',
    images: incoming.images || [],
    identifiers: {
      modelNumber: incoming.modelNumber || incoming.identifiers?.modelNumber || '',
      asin: incoming.identifiers?.asin || '',
      gtin: incoming.identifiers?.gtin || '',
      sku: incoming.identifiers?.sku || '',
      mpn: incoming.identifiers?.mpn || '',
      isbn: incoming.identifiers?.isbn || '',
    },
    attributes: incoming.attributes || incoming.variant || {},
    normalizedTitle: normalizeTitle(incoming.title),
  };

  const match = await matchingService.findBestMatch(payload, { storeId });

  if (match.matched) {
    logger.debug('Matched to existing product', {
      productId: match.product._id,
      confidence: match.confidence,
      reasons: match.reasons,
    });
    return { product: match.product, created: false, confidence: match.confidence };
  }

  const slug = await ensureUniqueSlug(payload.title);
  const product = await Product.create({
    ...payload,
    slug,
    isActive: true,
  });

  logger.info('Created canonical product', { productId: product._id, title: product.title });
  return { product, created: true, confidence: 0 };
};

/**
 * Upsert a store product listing linked to a canonical product.
 * Price changes go through the shared recorder (history + deals + alerts).
 */
const upsertStoreProduct = async (productId, storeResult) => {
  const discount =
    storeResult.mrp && storeResult.currentPrice && storeResult.mrp > storeResult.currentPrice
      ? Math.round(((storeResult.mrp - storeResult.currentPrice) / storeResult.mrp) * 100)
      : 0;

  const now = new Date();
  const health = {
    lastCheckedAt: now,
    lastSuccessfulFetchAt: now,
    scrapeStatus: 'SUCCESS',
    consecutiveFailureCount: 0,
    lastError: null,
    lastCheckStatus: 'SUCCESS',
    lastCheckError: null,
  };

  if (!isValidPrice(storeResult.currentPrice)) {
    throw new AppError('Invalid store price in search result', 400, 'INVALID_PRICE');
  }

  const existing = await StoreProduct.findOne({
    storeId: storeResult.storeId,
    externalProductId: storeResult.externalProductId,
  });

  if (existing) {
    // Existing listings keep their product link — relinking could violate the
    // one-listing-per-store-per-product index. Serialized with monitor checks of the
    // same listing so two writers can't record the same change twice.
    return withStoreProductLock(existing._id, async () => {
    const fresh = await StoreProduct.findById(existing._id);
    const { storeProduct } = await applyFetchedPrice(fresh, {
      newPrice: storeResult.currentPrice,
      mrp: storeResult.mrp,
      // Only overwrite stock status when the source actually reported one
      availability: storeResult.availability || undefined,
      title: storeResult.title,
      productUrl: storeResult.productUrl,
      images: storeResult.images,
      rating: storeResult.rating,
      reviewCount: storeResult.reviewCount,
      seller: storeResult.seller || '',
    });

    // isActive is deliberately left alone: an admin-disabled listing stays disabled
    if (storeResult.affiliateUrl && storeResult.affiliateUrl !== storeProduct.affiliateUrl) {
      storeProduct.affiliateUrl = storeResult.affiliateUrl;
      await storeProduct.save();
    }
    return storeProduct;
    });
  }

  const created = await StoreProduct.create({
    productId,
    storeId: storeResult.storeId,
    externalProductId: storeResult.externalProductId,
    title: storeResult.title,
    productUrl: storeResult.productUrl,
    affiliateUrl: storeResult.affiliateUrl || '',
    seller: storeResult.seller || '',
    currentPrice: storeResult.currentPrice,
    previousPrice: null,
    mrp: storeResult.mrp || null,
    discount,
    currency: storeResult.currency || 'INR',
    availability: storeResult.availability || 'UNKNOWN',
    rating: storeResult.rating || null,
    reviewCount: storeResult.reviewCount || 0,
    images: storeResult.images || [],
    variant: storeResult.variant || storeResult.attributes || {},
    isActive: true,
    ...health,
    // Just scraped — first recheck follows the normal schedule, not the next tick
    nextCheckAt: computeNextCheckAt({ tier: 'NORMAL' }),
  });

  // Seed price history so admin History / comparison graphs aren't empty
  await recordPriceChange({
    storeProduct: created,
    previousPrice: null,
    newPrice: storeResult.currentPrice,
    priceChanged: true,
    newAvailability: storeResult.availability || 'UNKNOWN',
  });

  return created;
};

/**
 * Search catalog in MongoDB. Live store scrape is opt-in via live=true (admin only, slow).
 * sort: relevance (default) | price_asc | price_desc | newest
 */
const searchProducts = async ({
  q,
  page = 1,
  limit = 20,
  live = false,
  sort = 'relevance',
  category,
  brand,
  minPrice,
  maxPrice,
} = {}) => {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(48, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * pageSize;
  const query = String(q || '').trim();

  if (live && query) {
    try {
      const storeResults = await storeIntegrationService.searchAllStores(query, { limit: 10 });
      for (const result of storeResults) {
        try {
          const { product } = await upsertCanonicalProduct(result, {
            storeId: result.storeId,
            externalProductId: result.externalProductId,
          });
          await upsertStoreProduct(product._id, result);
        } catch (err) {
          logger.error('Failed to upsert live search result', {
            error: err.message,
            title: result.title,
          });
        }
      }
    } catch (err) {
      logger.warn('Live store search skipped/failed', { error: err.message, q: query });
    }
  }

  const filter = await buildSearchFilter(query);
  const preferText = filter.__preferText;
  delete filter.__preferText;

  if (brand) filter.brand = new RegExp(`^${escapeRegex(brand)}$`, 'i');
  const min = Number(minPrice);
  const max = Number(maxPrice);
  if (min > 0 || max > 0) {
    filter['priceSummary.lowestPrice'] = {
      ...(min > 0 ? { $gte: min } : {}),
      ...(max > 0 ? { $lte: max } : {}),
    };
  }
  // Category counts for the sidebar reflect the current query/brand/price — not the whole catalog
  // Facets (category counts) are computed after the results, from whichever predicate
  // actually produced them, minus the category filter itself
  const facetBase = { ...filter };
  let textFacetMatch = null;
  if (category) filter.category = new RegExp(`^${escapeRegex(category)}$`, 'i');

  let items;
  let total;

  if (sort === 'price_asc' || sort === 'price_desc') {
    // Index-backed sorts on the denormalized summary (no $lookup)
    const order =
      sort === 'price_asc'
        ? { 'priceSummary.sortPrice': 1, _id: 1 }
        : { 'priceSummary.lowestPrice': -1, _id: 1 };
    [items, total] = await Promise.all([
      Product.find(filter).sort(order).skip(skip).limit(pageSize).lean(),
      Product.countDocuments(filter),
    ]);
  } else {
    if (preferText && sort === 'relevance') {
      try {
        const textFilter = { isActive: true, $text: { $search: preferText } };
        if (filter.category) textFilter.category = filter.category;
        if (filter.brand) textFilter.brand = filter.brand;
        if (filter['priceSummary.lowestPrice']) textFilter['priceSummary.lowestPrice'] = filter['priceSummary.lowestPrice'];
        total = await Product.countDocuments(textFilter);
        if (total > 0) {
          const { category: _omit, ...textNoCategory } = textFilter;
          textFacetMatch = textNoCategory;
          items = await Product.find(textFilter, { score: { $meta: 'textScore' } })
            .sort({ score: { $meta: 'textScore' } })
            .skip(skip)
            .limit(pageSize)
            .lean();
        }
      } catch (err) {
        logger.debug('Text search unavailable, using regex', { error: err.message });
      }
    }

    if (!items) {
      // No query → "recently updated" means freshest prices (price refreshes don't touch updatedAt)
      const order =
        sort === 'newest' ? { createdAt: -1, _id: -1 } : { 'priceSummary.lastCheckedAt': -1, _id: -1 };
      [items, total] = await Promise.all([
        Product.find(filter).sort(order).skip(skip).limit(pageSize).lean(),
        Product.countDocuments(filter),
      ]);
    }
  }

  const enriched = await enrichWithPrices(items);

  return {
    items: enriched,
    total,
    page: pageNum,
    limit: pageSize,
    pages: Math.ceil(total / pageSize) || 1,
    facets: {
      categories: (
        await Product.aggregate([
          { $match: textFacetMatch || facetBase },
          { $group: { _id: '$category', count: { $sum: 1 } } },
          { $match: { _id: { $nin: [null, ''] } } },
          { $sort: { count: -1 } },
          { $limit: 30 },
        ])
      ).map((f) => ({ name: f._id, count: f.count })),
    },
    sort,
    source: live ? 'db+live' : 'db',
  };
};

let categoryCache = { at: 0, data: null };

/** Distinct product categories with counts (cached 5 min). */
const listCategories = async () => {
  if (categoryCache.data && Date.now() - categoryCache.at < 5 * 60 * 1000) {
    return categoryCache.data;
  }
  const rows = await Product.aggregate([
    { $match: { isActive: true, category: { $nin: [null, ''] } } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 50 },
  ]);
  const data = { items: rows.map((r) => ({ name: r._id, count: r.count })) };
  categoryCache = { at: Date.now(), data };
  return data;
};

/**
 * "You may also like": same brand first, then same category; only products with a live price.
 */
const getSimilarProducts = async (id, { limit = 8 } = {}) => {
  const product = await Product.findById(id).select('brand category').lean();
  if (!product) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  const base = { _id: { $ne: product._id }, isActive: true, 'priceSummary.lowestPrice': { $gt: 0 } };
  const n = Math.min(12, Math.max(1, parseInt(limit, 10) || 8));
  const sameBrand = product.brand
    ? await Product.find({ ...base, brand: product.brand }).sort({ 'priceSummary.discountPercent': -1 }).limit(n).lean()
    : [];
  const rest =
    sameBrand.length < n && product.category
      ? await Product.find({ ...base, category: product.category, _id: { $nin: [product._id, ...sameBrand.map((p) => p._id)] } })
          .sort({ 'priceSummary.discountPercent': -1 })
          .limit(n - sameBrand.length)
          .lean()
      : [];
  return { items: await enrichWithPrices([...sameBrand, ...rest]) };
};

const getProductById = async (id, userId = null) => {
  const product = await Product.findById(id).lean();
  if (!product || !product.isActive) {
    throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  }

  const [storeProducts, watched] = await Promise.all([
    StoreProduct.find({ productId: product._id, isActive: true })
      .select('-lastError -lastCheckError -consecutiveFailureCount -lastFailedFetchAt -lastCheckStatus -scrapeStatus -monitorTier')
      .populate({ path: 'storeId', select: 'name slug logo domain isActive', match: { isActive: true } })
      .lean()
      .then((rows) => rows.filter((sp) => sp.storeId)),
    userId ? Watchlist.exists({ userId, productId: product._id }) : null,
  ]);
  const myAlert = userId
    ? await PriceAlert.findOne({
        userId,
        productId: product._id,
        status: { $in: ['ACTIVE', 'TRIGGERED', 'PAUSED'] },
      })
        .sort({ updatedAt: -1 })
        .select('targetPrice status storeProductId currentPrice notifiedBelowTarget lastNotifiedAt')
        .lean()
    : null;

  // Stale listings jump the monitor queue; the next tick (≤5 min) refreshes them
  const staleBefore = Date.now() - config.monitor.staleOnViewMin * 60 * 1000;
  const stale = storeProducts.some((sp) => !sp.lastCheckedAt || sp.lastCheckedAt.getTime() < staleBefore);
  if (stale) {
    require('./priceMonitoringService')
      .prioritizeProduct(product._id)
      .catch((err) => logger.debug('prioritizeProduct failed', { error: err.message }));
  }

  return {
    product,
    storeProducts,
    isWatched: Boolean(watched),
    myAlert,
    freshness: {
      lastCheckedAt: product.priceSummary?.lastCheckedAt || null,
      refreshQueued: stale,
    },
  };
};

module.exports = {
  searchProducts,
  listCategories,
  getSimilarProducts,
  enrichWithPrices,
  getProductById,
  upsertCanonicalProduct,
  upsertStoreProduct,
  ensureUniqueSlug,
};
