const adminService = require('../services/adminService');
const dealService = require('../services/dealService');
const ApiResponse = require('../utils/ApiResponse');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const jobRegistry = require('../utils/jobRegistry');

/** Respond 202 with a job snapshot; the admin UI polls GET /admin/jobs/:id. */
const accepted = (res, job, message) =>
  res.status(202).json({ success: true, message, data: { job } });

const dashboard = asyncHandler(async (req, res) => {
  const data = await adminService.getDashboardStats();
  return ApiResponse.success(res, data);
});

const listUsers = asyncHandler(async (req, res) => {
  const data = await adminService.listUsers(req.query);
  return ApiResponse.success(res, data);
});

const updateUser = asyncHandler(async (req, res) => {
  const user = await adminService.updateUser(req.user._id, req.params.id, req.body);
  return ApiResponse.success(res, user, 'User updated');
});

const listStores = asyncHandler(async (req, res) => {
  const items = await adminService.listStores();
  return ApiResponse.success(res, { items });
});

const createStore = asyncHandler(async (req, res) => {
  const store = await adminService.createStore(req.body);
  return ApiResponse.created(res, store, 'Store created');
});

const updateStore = asyncHandler(async (req, res) => {
  const store = await adminService.updateStore(req.params.id, req.body);
  return ApiResponse.success(res, store, 'Store updated');
});

const listProducts = asyncHandler(async (req, res) => {
  const data = await adminService.listProducts(req.query);
  return ApiResponse.success(res, data);
});

const updateProduct = asyncHandler(async (req, res) => {
  const product = await adminService.updateProduct(req.params.id, req.body);
  return ApiResponse.success(res, product, 'Product updated');
});

const listStoreProducts = asyncHandler(async (req, res) => {
  const data = await adminService.listStoreProducts(req.query);
  return ApiResponse.success(res, data);
});

const importStoreProduct = asyncHandler(async (req, res) => {
  const data = await adminService.importLiveStoreProduct(req.body);
  return ApiResponse.created(res, data, 'Store listing imported');
});

const scrapeByKeyword = asyncHandler(async (req, res) => {
  if (await jobRegistry.hasRunning('keyword-scrape')) {
    throw new AppError('A keyword scrape is already running', 409, 'JOB_RUNNING');
  }
  const { query, limit, stores } = req.body;
  const job = await jobRegistry.startJob('keyword-scrape', `Scrape “${query}”`, (report) =>
    adminService.scrapeStoresByKeyword({ query, limit, stores, onProgress: report })
  );
  return accepted(res, job, 'Keyword scrape started');
});

const updateStoreProduct = asyncHandler(async (req, res) => {
  const data = await adminService.updateStoreProduct(req.params.id, req.body);
  return ApiResponse.success(res, data, 'Store product updated');
});

const refreshPrices = asyncHandler(async (req, res) => {
  const productId = req.params.productId || req.body.productId;
  const { storeProductId, forceAll } = req.body;

  // Single listing / single product refreshes are quick enough to run inline
  if (storeProductId || productId) {
    const data = await adminService.triggerPriceRefresh({ productId, storeProductId });
    return ApiResponse.success(res, data, 'Price refresh completed');
  }

  if (await jobRegistry.hasRunning('refresh-all')) {
    throw new AppError('A full refresh is already running', 409, 'JOB_RUNNING');
  }
  const job = await jobRegistry.startJob('refresh-all', 'Refresh all prices', () =>
    adminService.triggerPriceRefresh({ forceAll: forceAll !== false })
  );
  return accepted(res, job, 'Full price refresh started');
});

/** Pull the latest Cuelinks stores + coupons now (needs CUELINKS_API_KEY). */
const syncAffiliate = asyncHandler(async (req, res) => {
  if (await jobRegistry.hasRunning('affiliate-sync')) {
    throw new AppError('An affiliate sync is already running', 409, 'JOB_RUNNING');
  }
  const job = await jobRegistry.startJob('affiliate-sync', 'Sync Cuelinks stores and offers', () =>
    require('../services/cuelinksService').syncFromApi()
  );
  return accepted(res, job, 'Affiliate sync started');
});

/** Run one scheduler tick now (only due listings) — same as the cron, but on demand. */
const runMonitorTick = asyncHandler(async (req, res) => {
  if (await jobRegistry.hasRunning('monitor-tick') || await jobRegistry.hasRunning('refresh-all')) {
    throw new AppError('A monitoring run is already in progress', 409, 'JOB_RUNNING');
  }
  const job = await jobRegistry.startJob('monitor-tick', 'Check due listings', () =>
    require('../services/priceMonitoringService').runPriceMonitoring()
  );
  return accepted(res, job, 'Monitor tick started');
});

const listJobs = asyncHandler(async (req, res) => ApiResponse.success(res, { items: await jobRegistry.listJobs() }));

const getJob = asyncHandler(async (req, res) => {
  const job = await jobRegistry.getJob(req.params.id);
  if (!job) throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
  return ApiResponse.success(res, job);
});

const monitoringStatus = asyncHandler(async (req, res) => {
  const data = await adminService.getMonitoringStatus();
  return ApiResponse.success(res, data);
});

const scraperHealth = asyncHandler(async (req, res) => {
  const data = await adminService.getScraperHealth();
  return ApiResponse.success(res, data);
});

const retryScraper = asyncHandler(async (req, res) => {
  const storeProductId = req.params.storeProductId || req.body.storeProductId;
  if (storeProductId) {
    const data = await adminService.retryFailedScrapes({ storeProductId });
    return ApiResponse.success(res, data, 'Scraper retry completed');
  }

  if (await jobRegistry.hasRunning('retry-failed')) {
    throw new AppError('A retry batch is already running', 409, 'JOB_RUNNING');
  }
  const limit = Math.min(500, Math.max(1, parseInt(req.body.limit, 10) || 50));
  const job = await jobRegistry.startJob('retry-failed', `Retry ${limit} failed listings`, () =>
    adminService.retryFailedScrapes({ limit })
  );
  return accepted(res, job, 'Retry batch started');
});

const failedChecks = asyncHandler(async (req, res) => {
  const data = await adminService.listFailedChecks(req.query);
  return ApiResponse.success(res, data);
});

const priceHistory = asyncHandler(async (req, res) => {
  const data = await adminService.listPriceHistoryAdmin(req.query);
  return ApiResponse.success(res, data);
});

const listNotifications = asyncHandler(async (req, res) => {
  const data = await adminService.listNotificationsAdmin(req.query);
  return ApiResponse.success(res, data);
});

const listDeals = asyncHandler(async (req, res) => {
  const data = await adminService.listDealsAdmin(req.query);
  return ApiResponse.success(res, data);
});

const createDeal = asyncHandler(async (req, res) => {
  const deal = await dealService.createDeal(req.body);
  return ApiResponse.created(res, deal, 'Deal created');
});

const updateDeal = asyncHandler(async (req, res) => {
  const deal = await dealService.updateDeal(req.params.id, req.body);
  return ApiResponse.success(res, deal, 'Deal updated');
});

module.exports = {
  syncAffiliate,
  dashboard,
  listUsers,
  updateUser,
  listStores,
  createStore,
  updateStore,
  listProducts,
  updateProduct,
  listStoreProducts,
  importStoreProduct,
  scrapeByKeyword,
  updateStoreProduct,
  refreshPrices,
  runMonitorTick,
  listJobs,
  getJob,
  monitoringStatus,
  scraperHealth,
  retryScraper,
  failedChecks,
  priceHistory,
  listNotifications,
  listDeals,
  createDeal,
  updateDeal,
};
