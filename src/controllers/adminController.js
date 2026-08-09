const adminService = require('../services/adminService');
const dealService = require('../services/dealService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const dashboard = asyncHandler(async (req, res) => {
  const data = await adminService.getDashboardStats();
  return ApiResponse.success(res, data);
});

const listUsers = asyncHandler(async (req, res) => {
  const data = await adminService.listUsers(req.query);
  return ApiResponse.success(res, data);
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

const listStoreProducts = asyncHandler(async (req, res) => {
  const data = await adminService.listStoreProducts(req.query);
  return ApiResponse.success(res, data);
});

const importStoreProduct = asyncHandler(async (req, res) => {
  const data = await adminService.importLiveStoreProduct(req.body);
  return ApiResponse.created(res, data, 'Store listing imported');
});

const scrapeByKeyword = asyncHandler(async (req, res) => {
  const data = await adminService.scrapeStoresByKeyword(req.body);
  return ApiResponse.success(res, data, 'Keyword scrape completed');
});

const updateStoreProduct = asyncHandler(async (req, res) => {
  const data = await adminService.updateStoreProduct(req.params.id, req.body);
  return ApiResponse.success(res, data, 'Store product updated');
});

const refreshPrices = asyncHandler(async (req, res) => {
  const data = await adminService.triggerPriceRefresh({
    productId: req.body.productId || req.params.productId,
    storeProductId: req.body.storeProductId,
    forceAll: req.body.forceAll,
  });
  return ApiResponse.success(res, data, 'Price refresh completed');
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
  const data = await adminService.retryFailedScrapes({
    storeProductId: req.params.storeProductId || req.body.storeProductId,
    limit: req.body.limit ? parseInt(req.body.limit, 10) : 50,
  });
  return ApiResponse.success(res, data, 'Scraper retry completed');
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
  dashboard,
  listUsers,
  listStores,
  createStore,
  updateStore,
  listProducts,
  listStoreProducts,
  importStoreProduct,
  scrapeByKeyword,
  updateStoreProduct,
  refreshPrices,
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
