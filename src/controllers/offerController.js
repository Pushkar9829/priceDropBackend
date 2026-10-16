const cuelinksService = require('../services/cuelinksService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { createTtlCache } = require('../utils/ttlCache');

// Offers change at most daily — a short cache absorbs bursts of identical anonymous reads
const cache = createTtlCache({ ttlMs: 60_000, max: 300 });
const str = (v) => (typeof v === 'string' ? v.slice(0, 100) : undefined);

const list = asyncHandler(async (req, res) => {
  const q = { category: str(req.query.category), store: str(req.query.store), q: str(req.query.q), type: str(req.query.type), page: req.query.page, limit: req.query.limit };
  const data = await cache.get(`offers:${JSON.stringify(q)}`, () => cuelinksService.listOffers(q));
  return ApiResponse.success(res, data);
});

const stores = asyncHandler(async (req, res) => {
  const q = { category: str(req.query.category), q: str(req.query.q), page: req.query.page, limit: req.query.limit };
  const data = await cache.get(`stores:${JSON.stringify(q)}`, () => cuelinksService.listStores(q));
  return ApiResponse.success(res, data);
});

const store = asyncHandler(async (req, res) => {
  const slug = str(req.params.slug);
  const data = await cache.get(`store:${slug}`, () => cuelinksService.getStore(slug));
  return ApiResponse.success(res, data);
});

const forDomain = asyncHandler(async (req, res) => {
  const domain = str(req.query.domain);
  const data = await cache.get(`domain:${domain}`, () => cuelinksService.offersForDomain(domain, 6));
  return ApiResponse.success(res, { items: data });
});

module.exports = { list, stores, store, forDomain };
