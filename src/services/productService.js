const { Product, StoreProduct, Brand } = require('../models');
const { createSlug, normalizeTitle } = require('../utils/helpers');
const AppError = require('../utils/AppError');
const matchingService = require('./matchingService');
const storeIntegrationService = require('./storeIntegrationService');
const logger = require('../utils/logger');
const { isValidPrice } = require('../integrations/stores/base/validator');
const { applyFetchedPrice, recordPriceChange } = require('./priceChangeRecorder');

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ensureUniqueSlug = async (base) => {
  let slug = createSlug(base) || `product-${Date.now()}`;
  let n = 0;
  while (await Product.exists({ slug })) {
    n += 1;
    slug = `${createSlug(base)}-${n}`;
  }
  return slug;
};

/**
 * Attach storeCount / lowest / highest price for a list of products (one aggregation).
 */
const enrichWithPrices = async (products) => {
  if (!products.length) return [];

  const ids = products.map((p) => p._id);
  const stats = await StoreProduct.aggregate([
    {
      $match: {
        productId: { $in: ids },
        isActive: true,
      },
    },
    {
      $group: {
        _id: '$productId',
        storeCount: { $sum: 1 },
        lowestPrice: {
          $min: {
            $cond: [
              {
                $and: [
                  { $ne: ['$availability', 'OUT_OF_STOCK'] },
                  { $gt: ['$currentPrice', 0] },
                ],
              },
              '$currentPrice',
              null,
            ],
          },
        },
        highestPrice: {
          $max: {
            $cond: [
              {
                $and: [
                  { $ne: ['$availability', 'OUT_OF_STOCK'] },
                  { $gt: ['$currentPrice', 0] },
                ],
              },
              '$currentPrice',
              null,
            ],
          },
        },
      },
    },
  ]);

  const byId = new Map(stats.map((s) => [String(s._id), s]));

  return products.map((product) => {
    const s = byId.get(String(product._id)) || {};
    return {
      id: product._id,
      title: product.title,
      brand: product.brand,
      category: product.category,
      subCategory: product.subCategory,
      images: product.images,
      slug: product.slug,
      storeCount: s.storeCount || 0,
      lowestPrice: s.lowestPrice ?? null,
      highestPrice: s.highestPrice ?? null,
      currency: 'INR',
    };
  });
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
 */
const upsertCanonicalProduct = async (incoming) => {
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

  const match = await matchingService.findBestMatch(payload);

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
    storeResult.mrp && storeResult.currentPrice
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
    const { storeProduct } = await applyFetchedPrice(existing, {
      newPrice: storeResult.currentPrice,
      mrp: storeResult.mrp,
      availability: storeResult.availability || 'UNKNOWN',
      title: storeResult.title,
      productUrl: storeResult.productUrl,
      images: storeResult.images,
      rating: storeResult.rating,
      reviewCount: storeResult.reviewCount,
      seller: storeResult.seller || '',
    });

    storeProduct.productId = productId;
    storeProduct.affiliateUrl = storeResult.affiliateUrl || storeProduct.affiliateUrl || '';
    storeProduct.isActive = true;
    await storeProduct.save();
    return storeProduct;
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
 * Search catalog in MongoDB. Live store scrape is opt-in via live=true (slow).
 */
const searchProducts = async ({ q, page = 1, limit = 20, live = false } = {}) => {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(48, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * pageSize;
  const query = String(q || '').trim();

  // Optional live scrape — never block brand/catalog UX by default
  if (live && query) {
    try {
      const storeResults = await storeIntegrationService.searchAllStores(query, { limit: 10 });
      for (const result of storeResults) {
        try {
          const { product } = await upsertCanonicalProduct(result);
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
  if (preferText) delete filter.__preferText;

  let items;
  let total;

  if (preferText) {
    try {
      const textFilter = { isActive: true, $text: { $search: preferText } };
      total = await Product.countDocuments(textFilter);
      if (total > 0) {
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
    [items, total] = await Promise.all([
      Product.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(pageSize).lean(),
      Product.countDocuments(filter),
    ]);
  }

  let enriched = await enrichWithPrices(items);

  if (query) {
    enriched.sort((a, b) => {
      const ap = a.lowestPrice == null ? Number.POSITIVE_INFINITY : a.lowestPrice;
      const bp = b.lowestPrice == null ? Number.POSITIVE_INFINITY : b.lowestPrice;
      return ap - bp;
    });
  }

  return {
    items: enriched,
    total,
    page: pageNum,
    limit: pageSize,
    pages: Math.ceil(total / pageSize) || 1,
    source: live ? 'db+live' : 'db',
  };
};

const getProductById = async (id) => {
  const product = await Product.findById(id);
  if (!product || !product.isActive) {
    throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  }

  const storeProducts = await StoreProduct.find({
    productId: product._id,
    isActive: true,
  }).populate('storeId', 'name slug logo domain isActive');

  return { product, storeProducts };
};

module.exports = {
  searchProducts,
  getProductById,
  upsertCanonicalProduct,
  upsertStoreProduct,
  ensureUniqueSlug,
};
