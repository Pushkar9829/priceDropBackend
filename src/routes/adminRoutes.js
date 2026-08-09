const express = require('express');
const adminController = require('../controllers/adminController');
const { protect, adminOnly } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { storeRules, mongoIdParam } = require('../middleware/validators');

const router = express.Router();

router.use(protect, adminOnly);

// Dashboard
router.get('/dashboard', adminController.dashboard);

// Users
router.get('/users', adminController.listUsers);

// Stores
router.get('/stores', adminController.listStores);
router.post('/stores', storeRules, validate, adminController.createStore);
router.patch('/stores/:id', mongoIdParam('id'), validate, adminController.updateStore);

// Products
router.get('/products', adminController.listProducts);
router.get('/store-products', adminController.listStoreProducts);
router.post('/store-products/import', adminController.importStoreProduct);
router.post('/store-products/scrape-keyword', adminController.scrapeByKeyword);
router.patch(
  '/store-products/:id',
  mongoIdParam('id'),
  validate,
  adminController.updateStoreProduct
);
router.post('/products/refresh', adminController.refreshPrices);
router.post('/products/:productId/refresh', mongoIdParam('productId'), validate, adminController.refreshPrices);

// Monitoring / Scraper health
router.get('/monitoring/status', adminController.monitoringStatus);
router.get('/monitoring/failed', adminController.failedChecks);
router.get('/scraper-health', adminController.scraperHealth);
router.post('/scraper-health/retry', adminController.retryScraper);
router.post(
  '/scraper-health/:storeProductId/retry',
  mongoIdParam('storeProductId'),
  validate,
  adminController.retryScraper
);

// Price history
router.get('/price-history', adminController.priceHistory);

// Notifications
router.get('/notifications', adminController.listNotifications);

// Deals
router.get('/deals', adminController.listDeals);
router.post('/deals', adminController.createDeal);
router.patch('/deals/:id', mongoIdParam('id'), validate, adminController.updateDeal);

module.exports = router;
