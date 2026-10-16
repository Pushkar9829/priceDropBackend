const cuelinksService = require('../services/cuelinksService');
const settingsService = require('../services/settingsService');
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

/** Public site settings the frontend needs (sections on/off, Cuelinks channel, travel widgets). */
const siteConfig = asyncHandler(async (req, res) => {
  // Admin changes must show on the next page load; the server keeps its own 30s copy
  res.set('Cache-Control', 'no-cache');
  return ApiResponse.success(res, settingsService.publicConfig(await settingsService.getAffiliateSettings()));
});

const travel = asyncHandler(async (req, res) => {
  const data = await cache.get('travel', () => cuelinksService.getTravel());
  return ApiResponse.success(res, data);
});

const flights = asyncHandler(async (req, res) => {
  const data = await require('../services/travelpayoutsService').cheapFlights(str(req.query.origin));
  return ApiResponse.success(res, data);
});

/** Called after admin changes so the public pages update immediately. */
const clearCache = () => {
  cache.clear();
  require('../services/travelpayoutsService').clearCache();
};

module.exports = { list, stores, store, forDomain, siteConfig, travel, flights, clearCache };
