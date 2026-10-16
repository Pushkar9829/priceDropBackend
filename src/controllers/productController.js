const productService = require('../services/productService');
const comparisonService = require('../services/comparisonService');
const ApiResponse = require('../utils/ApiResponse');
const { createTtlCache } = require('../utils/ttlCache');

// Hot anonymous reads are shared across visitors for a few seconds (see utils/ttlCache)
const searchCache = createTtlCache({ ttlMs: 30_000, max: 1000 });
const storesCache = createTtlCache({ ttlMs: 60_000, max: 1 });
const similarCache = createTtlCache({ ttlMs: 120_000, max: 2000 });
const asyncHandler = require('../utils/asyncHandler');

const search = asyncHandler(async (req, res) => {
  const { q, page = 1, limit = 20, live, sort, category, brand, minPrice, maxPrice, minDiscount } = req.query;
  const params = {
    q,
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    live: live === '1' || live === 'true',
    sort: sort || 'relevance',
    category,
    brand,
    minPrice,
    maxPrice,
    minDiscount,
  };
  // Live (admin) searches scrape stores and must never be served from cache
  const data = params.live
    ? await productService.searchProducts(params)
    : await searchCache.get(JSON.stringify(params), () => productService.searchProducts(params));
  return ApiResponse.success(res, data);
});

const categories = asyncHandler(async (req, res) => {
  const data = await productService.listCategories();
  return ApiResponse.success(res, data);
});

const similar = asyncHandler(async (req, res) => {
  const data = await similarCache.get(`${req.params.id}:${req.query.limit || ''}`, () =>
    productService.getSimilarProducts(req.params.id, { limit: req.query.limit })
  );
  return ApiResponse.success(res, data);
});

const listStores = asyncHandler(async (req, res) => {
  const data = await storesCache.get('stores', async () => {
    const { Store, StoreProduct } = require('../models');
    const [stores, counts] = await Promise.all([
      Store.find({ isActive: true }).select('name slug domain logo').sort({ name: 1 }).lean(),
      StoreProduct.aggregate([{ $match: { isActive: true } }, { $group: { _id: '$storeId', n: { $sum: 1 } } }]),
    ]);
    const byId = new Map(counts.map((c) => [String(c._id), c.n]));
    return { items: stores.map((s) => ({ ...s, listings: byId.get(String(s._id)) || 0 })) };
  });
  return ApiResponse.success(res, data);
});

const getById = asyncHandler(async (req, res) => {
  const data = await productService.getProductById(req.params.id, req.user?._id || null);
  return ApiResponse.success(res, data);
});

const getComparison = asyncHandler(async (req, res) => {
  const data = await comparisonService.getComparison(req.params.id);
  return ApiResponse.success(res, data);
});

const getPriceHistory = asyncHandler(async (req, res) => {
  const { storeProductId, days = 90 } = req.query;
  const data = await comparisonService.getPriceHistory(req.params.id, {
    storeProductId,
    days: parseInt(days, 10) || 90,
  });
  return ApiResponse.success(res, data);
});

module.exports = { search, categories, similar, listStores, getById, getComparison, getPriceHistory };
