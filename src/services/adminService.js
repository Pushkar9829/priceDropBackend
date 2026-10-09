const {
  User,
  Store,
  Product,
  StoreProduct,
  PriceHistory,
  Notification,
  Deal,
  PriceAlert,
} = require('../models');
const { createSlug } = require('../utils/helpers');
const { containsRegex } = require('../utils/regex');
const { inferBrand } = require('../utils/brandInference');
const AppError = require('../utils/AppError');
const priceMonitoringService = require('./priceMonitoringService');
const { deactivateDealsFor } = require('./dealService');
const productService = require('./productService');
const { isLiveFlipkartUrl } = require('../integrations/stores/flipkart/flipkart.scraper');
const { isLiveAmazonUrl } = require('../integrations/stores/amazon/amazon.scraper');
const { isLiveCromaUrl } = require('../integrations/stores/croma/croma.scraper');
const { closeBrowser } = require('../integrations/stores/base/browserClient');
const config = require('../config');
const logger = require('../utils/logger');
const {
  refreshProductSummaries,
  refreshForStore,
  invalidateStores,
} = require('./productSummaryService');

const detectLiveStoreSlug = (url = '') => {
  if (isLiveFlipkartUrl(url)) return 'flipkart';
  if (isLiveAmazonUrl(url)) return 'amazon';
  if (isLiveCromaUrl(url)) return 'croma';
  return null;
};

const toPageLimit = (page = 1, limit = 20) => {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  return { page: p, limit: l, skip: (p - 1) * l };
};

const listUsers = async ({ page = 1, limit = 20, search } = {}) => {
  const filter = {};
  if (search) {
    filter.$or = [
      { name: containsRegex(search) },
      { email: containsRegex(search) },
    ];
  }
  const { page: p, limit: l, skip } = toPageLimit(page, limit);
  const [items, total] = await Promise.all([
    User.find(filter).select('-password').sort({ createdAt: -1 }).skip(skip).limit(l),
    User.countDocuments(filter),
  ]);
  return { items, total, page: p, limit: l, pages: Math.ceil(total / l) || 1 };
};

/**
 * Admin can (de)activate users or change roles — never on their own account,
 * so an admin can't lock themselves out.
 */
const updateUser = async (actorId, id, { isActive, role } = {}) => {
  if (String(actorId) === String(id)) {
    throw new AppError('You cannot change your own account here', 400, 'SELF_UPDATE');
  }
  const patch = {};
  if (isActive !== undefined) patch.isActive = isActive;
  if (role !== undefined) patch.role = role;
  if (!Object.keys(patch).length) throw new AppError('No valid fields to update', 400, 'EMPTY_UPDATE');
  const user = await User.findByIdAndUpdate(id, patch, { new: true, runValidators: true }).select('-password');
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  return user;
};

const listStores = async () => {
  const [stores, counts] = await Promise.all([
    Store.find().sort({ name: 1 }).lean(),
    StoreProduct.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$storeId', listings: { $sum: 1 } } },
    ]),
  ]);
  const byStore = new Map(counts.map((c) => [String(c._id), c.listings]));
  return stores.map((s) => ({ ...s, listings: byStore.get(String(s._id)) || 0 }));
};

const createStore = async (data) => {
  const slug = data.slug || createSlug(data.name);
  const existing = await Store.findOne({ $or: [{ slug }, { name: data.name }] });
  if (existing) {
    throw new AppError('Store already exists', 409, 'STORE_EXISTS');
  }
  invalidateStores();
  return Store.create({
    name: data.name,
    slug,
    domain: data.domain,
    logo: data.logo || '',
    isActive: data.isActive !== false,
    integrationType: data.integrationType || 'DEMO_FEED',
    config: data.config || {},
  });
};

const STORE_FIELDS = ['name', 'domain', 'logo', 'isActive', 'integrationType', 'config'];

const updateStore = async (id, updates = {}) => {
  const patch = Object.fromEntries(
    STORE_FIELDS.filter((k) => updates[k] !== undefined).map((k) => [k, updates[k]])
  );
  if (!Object.keys(patch).length) throw new AppError('No valid fields to update', 400, 'EMPTY_UPDATE');
  const before = await Store.findById(id).select('isActive').lean();
  const store = await Store.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
  if (!store) throw new AppError('Store not found', 404, 'STORE_NOT_FOUND');
  if (patch.isActive === false) await deactivateDealsFor({ storeId: store._id });
  if (patch.isActive !== undefined && before?.isActive !== store.isActive) {
    // Its listings enter/leave every comparison — rebuild affected product summaries
    refreshForStore(store._id).catch((err) => logger.error('Store summary refresh failed', { error: err.message }));
  }
  return store;
};

const PRODUCT_FIELDS = ['title', 'brand', 'category', 'subCategory', 'description', 'isActive'];

const updateProduct = async (id, updates = {}) => {
  const patch = {};
  for (const key of PRODUCT_FIELDS) {
    if (updates[key] === undefined) continue;
    patch[key] = key === 'isActive' ? updates[key] === true || updates[key] === 'true' : String(updates[key]).trim();
  }
  if (patch.title === '') throw new AppError('Title cannot be empty', 400, 'VALIDATION_ERROR');
  if (Array.isArray(updates.images)) {
    patch.images = updates.images.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 10);
  }
  if (!Object.keys(patch).length) throw new AppError('No valid fields to update', 400, 'EMPTY_UPDATE');
  if (patch.title) patch.normalizedTitle = require('../utils/helpers').normalizeTitle(patch.title);
  const product = await Product.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
  if (!product) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  if (patch.isActive === false) await deactivateDealsFor({ productId: product._id });
  return product;
};

const listProducts = async ({ page = 1, limit = 20, search, category, isActive } = {}) => {
  const filter = {};
  if (search) {
    filter.$or = [{ title: containsRegex(search) }, { brand: containsRegex(search) }];
  }
  if (isActive === 'true') filter.isActive = true;
  if (isActive === 'false') filter.isActive = false;
  if (typeof category === 'string' && category) filter.category = category;
  const { page: p, limit: l, skip } = toPageLimit(page, limit);
  const [items, total] = await Promise.all([
    Product.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(l).lean(),
    Product.countDocuments(filter),
  ]);

  return {
    items: items.map((item) => ({
      ...item,
      lowestPrice: item.priceSummary?.lowestPrice ?? null,
      highestPrice: item.priceSummary?.highestPrice ?? null,
      storeCount: item.priceSummary?.storeCount ?? 0,
    })),
    total,
    page: p,
    limit: l,
    pages: Math.ceil(total / l) || 1,
  };
};

const isObjectId = (v) =>
  typeof v === 'string' &&
  v !== 'undefined' &&
  v !== 'null' &&
  /^[a-f\d]{24}$/i.test(v);

const listStoreProducts = async ({
  page = 1,
  limit = 20,
  storeId,
  productId,
  status,
  search,
  liveOnly,
} = {}) => {
  const filter = {};
  if (isObjectId(storeId)) filter.storeId = storeId;
  if (isObjectId(productId)) filter.productId = productId;
  if (typeof status === 'string' && status && status !== 'undefined') filter.scrapeStatus = status;

  const and = [];
  const q = String(search || '').trim();
  if (q) {
    and.push({
      $or: [
        { title: containsRegex(q) },
        { externalProductId: containsRegex(q) },
        { productUrl: containsRegex(q) },
        { seller: containsRegex(q) },
      ],
    });
  }

  const live = liveOnly === true || liveOnly === 'true' || liveOnly === '1';
  if (live) {
    and.push({ productUrl: { $regex: /(flipkart\.com|amazon\.|croma\.com)/i } });
    and.push({ productUrl: { $not: { $regex: /(127\.0\.0\.1|localhost|demo\.)/i } } });
  }

  if (and.length) filter.$and = and;

  const { page: p, limit: l, skip } = toPageLimit(page, limit);
  const [items, total] = await Promise.all([
    StoreProduct.find(filter)
      .populate('storeId', 'name slug')
      .populate('productId', 'title brand')
      .sort({ consecutiveFailureCount: -1, lastCheckedAt: -1 })
      .skip(skip)
      .limit(l),
    StoreProduct.countDocuments(filter),
  ]);
  return { items, total, page: p, limit: l, pages: Math.ceil(total / l) || 1 };
};

/**
 * Import a live Amazon / Flipkart / Croma PDP URL → scrape → upsert listing.
 */
const importLiveStoreProduct = async ({ url, productId } = {}) => {
  const slug = detectLiveStoreSlug(url);
  if (!slug) {
    throw new AppError(
      'URL must be a Flipkart, Amazon.in, or Croma product page',
      400,
      'INVALID_STORE_URL'
    );
  }

  if (config.scraper.mode === 'demo') {
    throw new AppError(
      'Set SCRAPER_MODE=http to import live store URLs',
      400,
      'SCRAPER_MODE_DEMO'
    );
  }

  if (!config.scraper.enablePlaywright) {
    throw new AppError(
      'Set SCRAPER_ENABLE_PLAYWRIGHT=true to import live store URLs',
      400,
      'PLAYWRIGHT_DISABLED'
    );
  }

  const storeDoc = await Store.findOne({ slug, isActive: true });
  if (!storeDoc) {
    throw new AppError(`${slug} store is missing or inactive`, 404, 'STORE_NOT_FOUND');
  }

  const { createIntegration } = require('../integrations');
  const integration = createIntegration(storeDoc);
  if (!integration) {
    throw new AppError(`No integration for ${slug}`, 500, 'NO_INTEGRATION');
  }

  let details;
  try {
    details = await integration.getProductDetails('import', { productUrl: url });
  } catch (err) {
    logger.error('Live store import scrape failed', { store: slug, url, error: err.message });
    throw new AppError(
      `${storeDoc.name} scrape failed: ${err.message}`,
      502,
      'STORE_SCRAPE_FAILED'
    );
  } finally {
    await closeBrowser().catch(() => {});
  }

  if (!details?.externalProductId) {
    throw new AppError(
      `Could not extract product id from the ${storeDoc.name} page`,
      502,
      'MISSING_PID'
    );
  }

  let product;
  let created = false;
  if (productId) {
    product = await Product.findById(productId);
    if (!product || !product.isActive) {
      throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
    }
  } else {
    const upserted = await productService.upsertCanonicalProduct({
      title: details.title,
      brand: details.brand,
      category: details.category,
      images: details.images,
      identifiers: {
        ...(details.identifiers || {}),
        asin: details.identifiers?.asin || (slug === 'amazon' ? details.externalProductId : ''),
      },
      attributes: details.attributes || details.variant,
    }, { storeId: storeDoc._id, externalProductId: details.externalProductId });
    product = upserted.product;
    created = upserted.created;
  }

  const storeProduct = await productService.upsertStoreProduct(product._id, {
    storeId: storeDoc._id,
    externalProductId: details.externalProductId,
    title: details.title,
    productUrl: details.productUrl || url,
    affiliateUrl: '',
    seller: details.seller || storeDoc.name,
    currentPrice: details.currentPrice,
    mrp: details.mrp,
    currency: details.currency || 'INR',
    availability: details.availability,
    rating: details.rating,
    reviewCount: details.reviewCount,
    images: details.images,
    variant: details.variant || details.attributes,
  });

  return {
    store: slug,
    product: {
      id: product._id,
      title: product.title,
      created,
    },
    storeProduct,
    collectionMethod: details.collectionMethod,
  };
};

/** @deprecated alias — prefer importLiveStoreProduct */
const importFlipkartStoreProduct = async (opts) => importLiveStoreProduct(opts);

/**
 * Search Amazon / Flipkart / Croma by keyword, upsert URLs + prices.
 * Cron later re-hits each productUrl and writes PriceHistory on change.
 *
 * @param {{ query: string, limit?: number, stores?: string[] }} opts
 */
const KEYWORD_SCRAPE_STORES = ['amazon', 'flipkart', 'croma'];
/** Safety ceiling so "all" cannot run forever (Flipkart ~24–40 cards/page). */
const KEYWORD_SCRAPE_MAX = 1000;

const parseKeywordLimit = (limit) => {
  if (limit === 'all' || limit === '*' || limit === true) return KEYWORD_SCRAPE_MAX;
  const n = parseInt(limit, 10);
  if (!Number.isFinite(n) || n < 1) return 10;
  return Math.min(n, KEYWORD_SCRAPE_MAX);
};

/**
 * Upsert search hits into Product + StoreProduct.
 * @param {{ storeDoc: object, storeSlug: string, items: object[], forcedBrand?: string, category?: string, collectItems?: boolean }} opts
 */
const ingestSearchResults = async ({
  storeDoc,
  storeSlug,
  items = [],
  forcedBrand,
  category,
  collectItems = true,
} = {}) => {
  const storeSummary = {
    found: items.length,
    saved: 0,
    skipped: 0,
    errors: [],
    items: [],
  };

  for (const item of items) {
    try {
      if (!item.productUrl || !item.externalProductId) {
        storeSummary.skipped += 1;
        continue;
      }

      // Search results rarely carry a brand — recover it (and its category) from the title
      const inferred = !forcedBrand && !item.brand ? inferBrand(item.title) : null;
      const { product, created } = await productService.upsertCanonicalProduct({
        title: item.title,
        brand: forcedBrand || item.brand || inferred?.name,
        category: category || item.category || inferred?.category,
        images: item.images,
        identifiers: {
          ...(item.identifiers || {}),
          asin: item.identifiers?.asin || (storeSlug === 'amazon' ? item.externalProductId : ''),
        },
        attributes: item.attributes || item.variant,
      }, { storeId: storeDoc._id, externalProductId: item.externalProductId });

      const storeProduct = await productService.upsertStoreProduct(product._id, {
        storeId: storeDoc._id,
        storeSlug,
        externalProductId: item.externalProductId,
        title: item.title,
        productUrl: item.productUrl,
        affiliateUrl: '',
        seller: item.seller || storeDoc.name,
        currentPrice: item.currentPrice,
        mrp: item.mrp,
        currency: item.currency || 'INR',
        availability: item.availability || 'IN_STOCK',
        rating: item.rating,
        reviewCount: item.reviewCount,
        images: item.images,
        variant: item.variant || item.attributes,
      });

      storeSummary.saved += 1;
      if (collectItems) {
        storeSummary.items.push({
          store: storeSlug,
          productId: product._id,
          storeProductId: storeProduct._id,
          title: storeProduct.title,
          currentPrice: storeProduct.currentPrice,
          productUrl: storeProduct.productUrl,
          created,
        });
      }
    } catch (err) {
      storeSummary.skipped += 1;
      storeSummary.errors.push({ title: item.title, error: err.message });
      logger.warn('Keyword scrape upsert failed', {
        store: storeSlug,
        title: item.title,
        error: err.message,
      });
    }
  }

  return storeSummary;
};

const scrapeStoresByKeyword = async ({
  query,
  limit = 10,
  stores = KEYWORD_SCRAPE_STORES,
  forcedBrand,
  category,
  closeBrowserWhenDone = true,
  onProgress = () => {},
} = {}) => {
  const q = String(query || '').trim();
  if (!q) {
    throw new AppError('Search keyword is required', 400, 'MISSING_QUERY');
  }

  const max = parseKeywordLimit(limit);
  const requested = (Array.isArray(stores) && stores.length
    ? stores
    : KEYWORD_SCRAPE_STORES
  )
    .map((s) => String(s).toLowerCase().trim())
    .filter((s) => KEYWORD_SCRAPE_STORES.includes(s));

  if (!requested.length) {
    throw new AppError(
      'Select at least one store: amazon, flipkart, croma',
      400,
      'INVALID_STORES'
    );
  }

  if (config.scraper.mode === 'demo') {
    throw new AppError(
      'Set SCRAPER_MODE=http to scrape stores by keyword',
      400,
      'SCRAPER_MODE_DEMO'
    );
  }

  if (!config.scraper.enablePlaywright) {
    throw new AppError(
      'Set SCRAPER_ENABLE_PLAYWRIGHT=true to scrape stores by keyword',
      400,
      'PLAYWRIGHT_DISABLED'
    );
  }

  const { createIntegration } = require('../integrations');
  const summary = {
    query: q,
    stores: requested,
    found: 0,
    saved: 0,
    skipped: 0,
    errors: [],
    byStore: {},
    items: [],
  };

  try {
    for (const slug of requested) {
      const storeDoc = await Store.findOne({ slug, isActive: true });
      const emptyStore = {
        found: 0,
        saved: 0,
        skipped: 0,
        errors: [],
      };
      summary.byStore[slug] = emptyStore;

      if (!storeDoc) {
        emptyStore.errors.push({ error: 'Store missing or inactive' });
        summary.errors.push({ store: slug, error: 'Store missing or inactive' });
        continue;
      }

      const integration = createIntegration(storeDoc);
      if (!integration?.scraper?.searchLive) {
        emptyStore.errors.push({ error: 'Live search not supported' });
        summary.errors.push({ store: slug, error: 'Live search not supported' });
        continue;
      }

      onProgress({ store: slug, stage: 'searching', saved: summary.saved });
      let searchItems = [];
      try {
        searchItems = await integration.scraper.searchLive(q, {
          limit: max,
          maxPages: Math.min(120, Math.ceil(max / 10) + 3),
        });
      } catch (err) {
        logger.error('Keyword search failed', { store: slug, query: q, error: err.message });
        emptyStore.errors.push({ error: err.message });
        summary.errors.push({ store: slug, error: err.message });
        continue;
      }

      onProgress({ store: slug, stage: 'saving', found: searchItems.length, saved: summary.saved });
      const storeSummary = await ingestSearchResults({
        storeDoc,
        storeSlug: slug,
        items: searchItems,
        forcedBrand,
        category,
        collectItems: true,
      });

      summary.byStore[slug] = {
        found: storeSummary.found,
        saved: storeSummary.saved,
        skipped: storeSummary.skipped,
        errors: storeSummary.errors,
      };
      summary.found += storeSummary.found;
      summary.saved += storeSummary.saved;
      summary.skipped += storeSummary.skipped;
      summary.items.push(...storeSummary.items);
      for (const e of storeSummary.errors) {
        summary.errors.push({ store: slug, ...e });
      }
    }
  } finally {
    if (closeBrowserWhenDone) {
      await closeBrowser().catch(() => {});
    }
  }

  logger.info('Multi-store keyword scrape completed', {
    query: q,
    stores: requested,
    found: summary.found,
    saved: summary.saved,
    skipped: summary.skipped,
  });

  return summary;
};

/** @deprecated use scrapeStoresByKeyword — kept for older callers */
const scrapeFlipkartByKeyword = async ({ query, limit = 10 } = {}) =>
  scrapeStoresByKeyword({ query, limit, stores: ['flipkart'] });

/**
 * Patch listing fields (promote fixture URL → live Flipkart URL, etc.).
 */
const updateStoreProduct = async (id, updates = {}) => {
  const allowed = [
    'productUrl',
    'externalProductId',
    'affiliateUrl',
    'isActive',
    'title',
    'seller',
  ];
  const patch = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) patch[key] = updates[key];
  }

  if (Object.keys(patch).length === 0) {
    throw new AppError('No valid fields to update', 400, 'EMPTY_UPDATE');
  }

  if (patch.productUrl && !patch.externalProductId) {
    try {
      const u = new URL(patch.productUrl);
      const pid =
        u.searchParams.get('pid') ||
        u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1] ||
        u.pathname.match(/\/p\/([^/?#]+)/i)?.[1];
      if (pid) patch.externalProductId = pid;
    } catch {
      // ignore
    }
  }

  if (patch.productUrl || patch.externalProductId) {
    // New source → check it on the next tick with a clean failure streak
    Object.assign(patch, { nextCheckAt: new Date(), consecutiveFailureCount: 0, scrapeStatus: 'PENDING' });
  }

  const storeProduct = await StoreProduct.findByIdAndUpdate(id, patch, {
    new: true,
    runValidators: true,
  })
    .populate('storeId', 'name slug')
    .populate('productId', 'title brand');

  if (!storeProduct) {
    throw new AppError('Store product not found', 404, 'STORE_PRODUCT_NOT_FOUND');
  }
  if (patch.isActive === false) await deactivateDealsFor({ storeProductId: storeProduct._id });
  if (patch.isActive !== undefined) {
    await refreshProductSummaries([storeProduct.productId?._id || storeProduct.productId]);
  }

  return storeProduct;
};

const listFailedChecks = async ({ page = 1, limit = 20 } = {}) => {
  const filter = {
    scrapeStatus: {
      $in: ['FAILED', 'PRODUCT_NOT_FOUND', 'TEMPORARILY_UNAVAILABLE'],
    },
  };
  const { page: p, limit: l, skip } = toPageLimit(page, limit);
  const [items, total] = await Promise.all([
    StoreProduct.find(filter)
      .populate('storeId', 'name slug')
      .populate('productId', 'title brand')
      .sort({ consecutiveFailureCount: -1, lastFailedFetchAt: -1 })
      .skip(skip)
      .limit(l),
    StoreProduct.countDocuments(filter),
  ]);
  return { items, total, page: p, limit: l, pages: Math.ceil(total / l) || 1 };
};

const getMonitoringStatus = async () => {
  const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [[agg], schedule, recentChanges] = await Promise.all([
    // One pass over active listings instead of ~10 countDocuments calls
    StoreProduct.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$scrapeStatus', 'PENDING'] }, 1, 0] } },
          success: { $sum: { $cond: [{ $eq: ['$scrapeStatus', 'SUCCESS'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $in: ['$scrapeStatus', ['FAILED', 'TEMPORARILY_UNAVAILABLE']] }, 1, 0] } },
          productNotFound: { $sum: { $cond: [{ $eq: ['$scrapeStatus', 'PRODUCT_NOT_FOUND'] }, 1, 0] } },
          outOfStock: { $sum: { $cond: [{ $eq: ['$scrapeStatus', 'OUT_OF_STOCK'] }, 1, 0] } },
          neverChecked: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$lastCheckedAt', null] }, null] }, 1, 0] } },
          repeatedFailures: { $sum: { $cond: [{ $gte: ['$consecutiveFailureCount', 3] }, 1, 0] } },
          staleOver24h: {
            $sum: {
              $cond: [
                { $lt: [{ $ifNull: ['$lastSuccessfulFetchAt', new Date(0)] }, staleThreshold] },
                1,
                0,
              ],
            },
          },
          lastCheckedAt: { $max: '$lastCheckedAt' },
          lastSuccessfulFetchAt: { $max: '$lastSuccessfulFetchAt' },
        },
      },
    ]),
    priceMonitoringService.getScheduleStats(),
    PriceHistory.find({ changeType: { $in: ['DECREASE', 'INCREASE'] } })
      .sort({ recordedAt: -1 })
      .limit(8)
      .populate('storeId', 'name')
      .populate('productId', 'title')
      .lean(),
  ]);

  const a = agg || {};
  const { currentRun, lastRun } = priceMonitoringService.getRunState();
  return {
    totalActiveStoreProducts: a.total || 0,
    pending: a.pending || 0,
    success: a.success || 0,
    failed: a.failed || 0,
    productNotFound: a.productNotFound || 0,
    outOfStock: a.outOfStock || 0,
    neverChecked: a.neverChecked || 0,
    repeatedFailures: a.repeatedFailures || 0,
    staleOver24h: a.staleOver24h || 0,
    lastCheckedAt: a.lastCheckedAt || null,
    lastSuccessfulFetchAt: a.lastSuccessfulFetchAt || null,
    schedule,
    currentRun,
    lastRun,
    recentChanges,
  };
};

/**
 * Scraper health dashboard for admin panel.
 */
const getScraperHealth = async () => {
  const overview = await getMonitoringStatus();

  const byStore = await StoreProduct.aggregate([
    { $match: { isActive: true } },
    {
      $group: {
        _id: '$storeId',
        total: { $sum: 1 },
        success: {
          $sum: { $cond: [{ $eq: ['$scrapeStatus', 'SUCCESS'] }, 1, 0] },
        },
        failed: {
          $sum: {
            $cond: [
              { $in: ['$scrapeStatus', ['FAILED', 'PRODUCT_NOT_FOUND']] },
              1,
              0,
            ],
          },
        },
        avgFailures: { $avg: '$consecutiveFailureCount' },
        lastSuccess: { $max: '$lastSuccessfulFetchAt' },
        lastFailure: { $max: '$lastFailedFetchAt' },
      },
    },
  ]);

  const stores = await Store.find().select('name slug').lean();
  const storeMap = Object.fromEntries(stores.map((s) => [String(s._id), s]));

  const storeHealth = byStore.map((row) => ({
    storeId: row._id,
    store: storeMap[String(row._id)] || null,
    total: row.total,
    success: row.success,
    failed: row.failed,
    avgConsecutiveFailures: Math.round((row.avgFailures || 0) * 100) / 100,
    lastSuccessfulFetchAt: row.lastSuccess,
    lastFailedFetchAt: row.lastFailure,
  }));

  const repeatedFailures = await StoreProduct.find({
    isActive: true,
    consecutiveFailureCount: { $gte: 3 },
  })
    .populate('storeId', 'name slug')
    .populate('productId', 'title brand')
    .sort({ consecutiveFailureCount: -1 })
    .limit(50);

  return { overview, storeHealth, repeatedFailures };
};

const retryFailedScrapes = async ({ storeProductId, limit = 50 } = {}) => {
  if (storeProductId) {
    const result = await priceMonitoringService.checkStoreProduct(storeProductId);
    return { mode: 'single', storeProductId, result };
  }

  const failed = await StoreProduct.find({
    isActive: true,
    scrapeStatus: { $in: ['FAILED', 'PRODUCT_NOT_FOUND', 'TEMPORARILY_UNAVAILABLE'] },
  })
    .select('_id')
    .limit(limit)
    .lean();

  const config = require('../config');
  const { runWithConcurrency } = require('../utils/concurrency');

  const results = await runWithConcurrency(
    failed,
    config.scraper.concurrency,
    async ({ _id }) => priceMonitoringService.checkStoreProduct(_id)
  );

  return {
    mode: 'batch',
    total: failed.length,
    results,
  };
};

const triggerPriceRefresh = async ({
  productId,
  storeProductId,
  forceAll = false,
} = {}) => {
  if (storeProductId) {
    const result = await priceMonitoringService.checkStoreProduct(storeProductId);
    return { mode: 'storeProduct', storeProductId, result };
  }

  if (productId) {
    const config = require('../config');
    const { runWithConcurrency } = require('../utils/concurrency');
    const storeProducts = await StoreProduct.find({ productId, isActive: true }).select('_id');
    const results = await runWithConcurrency(
      storeProducts,
      config.scraper.concurrency,
      async (sp) => priceMonitoringService.checkStoreProduct(sp._id)
    );
    return { mode: 'product', productId, results };
  }

  const summary = await priceMonitoringService.runPriceMonitoring({ force: forceAll !== false });
  return { mode: 'all', summary };
};

const listPriceHistoryAdmin = async ({
  page = 1,
  limit = 50,
  productId,
  storeProductId,
  storeId,
  changeType,
  search,
} = {}) => {
  const filter = {};
  if (isObjectId(storeProductId)) filter.storeProductId = storeProductId;
  if (isObjectId(storeId)) filter.storeId = storeId;
  if (typeof changeType === 'string' && changeType && changeType !== 'undefined') filter.changeType = changeType;

  const { page: p, limit: l, skip } = toPageLimit(page, limit);
  const q = String(search || '').trim();

  if (q || isObjectId(productId)) {
    const productFilter = {};
    if (isObjectId(productId)) productFilter._id = productId;
    if (q) {
      productFilter.$or = [
        { title: containsRegex(q) },
        { brand: containsRegex(q) },
      ];
    }
    const products = await Product.find(productFilter).select('_id').lean();
    const ids = products.map((doc) => doc._id);
    if (!ids.length) {
      return { items: [], total: 0, page: p, limit: l, pages: 1 };
    }
    filter.productId = { $in: ids };
  }

  const [items, total] = await Promise.all([
    PriceHistory.find(filter)
      .populate('storeId', 'name slug')
      .populate('productId', 'title brand')
      .sort({ recordedAt: -1 })
      .skip(skip)
      .limit(l),
    PriceHistory.countDocuments(filter),
  ]);
  return { items, total, page: p, limit: l, pages: Math.ceil(total / l) || 1 };
};

const listNotificationsAdmin = async ({ page = 1, limit = 50 } = {}) => {
  const { page: p, limit: l, skip } = toPageLimit(page, limit);
  const [items, total] = await Promise.all([
    Notification.find()
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(l),
    Notification.countDocuments(),
  ]);
  return { items, total, page: p, limit: l, pages: Math.ceil(total / l) || 1 };
};

const listDealsAdmin = async ({
  page = 1,
  limit = 20,
  storeId,
  dropSeverity,
  isActive,
  search,
} = {}) => {
  const filter = {};
  if (isObjectId(storeId)) filter.storeId = storeId;
  if (typeof dropSeverity === 'string' && dropSeverity && dropSeverity !== 'undefined') filter.dropSeverity = dropSeverity;
  if (isActive === true || isActive === 'true') filter.isActive = true;
  if (isActive === false || isActive === 'false') filter.isActive = false;

  const { page: p, limit: l, skip } = toPageLimit(page, limit);
  const q = String(search || '').trim();

  if (q) {
    const products = await Product.find({
      $or: [{ title: containsRegex(q) }, { brand: containsRegex(q) }],
    })
      .select('_id')
      .lean();
    const productIds = products.map((doc) => doc._id);
    filter.$or = [
      { title: containsRegex(q) },
      { description: containsRegex(q) },
      ...(productIds.length ? [{ productId: { $in: productIds } }] : []),
    ];
  }

  const [items, total] = await Promise.all([
    Deal.find(filter)
      .populate('productId', 'title brand')
      .populate('storeId', 'name slug')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(l),
    Deal.countDocuments(filter),
  ]);
  return { items, total, page: p, limit: l, pages: Math.ceil(total / l) || 1 };
};

const getDashboardStats = async () => {
  const [users, products, stores, storeProducts, alerts, deals, notifications] = await Promise.all([
    User.countDocuments(),
    Product.countDocuments({ isActive: true }),
    Store.countDocuments({ isActive: true }),
    StoreProduct.countDocuments({ isActive: true }),
    PriceAlert.countDocuments({ status: 'ACTIVE' }),
    Deal.countDocuments({ isActive: true }),
    Notification.countDocuments(),
  ]);
  const monitoring = await getMonitoringStatus();
  return { users, products, stores, storeProducts, alerts, deals, notifications, monitoring };
};

module.exports = {
  listUsers,
  listStores,
  createStore,
  updateStore,
  updateUser,
  updateProduct,
  listProducts,
  listStoreProducts,
  importFlipkartStoreProduct,
  importLiveStoreProduct,
  scrapeFlipkartByKeyword,
  scrapeStoresByKeyword,
  ingestSearchResults,
  KEYWORD_SCRAPE_MAX,
  updateStoreProduct,
  listFailedChecks,
  getMonitoringStatus,
  getScraperHealth,
  retryFailedScrapes,
  triggerPriceRefresh,
  listPriceHistoryAdmin,
  listNotificationsAdmin,
  listDealsAdmin,
  getDashboardStats,
};
