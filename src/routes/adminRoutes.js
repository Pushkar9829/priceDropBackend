const express = require('express');
const adminController = require('../controllers/adminController');
const { protect, adminOnly } = require('../middleware/auth');
const validate = require('../middleware/validate');
const v = require('../middleware/validators');

const router = express.Router();

router.use(protect, adminOnly);

// Dashboard
router.get('/dashboard', adminController.dashboard);

// Users
router.get('/users', adminController.listUsers);
router.patch('/users/:id', v.mongoIdParam('id'), v.userUpdateRules, validate, adminController.updateUser);

// Stores
router.get('/stores', adminController.listStores);
router.post('/stores', v.storeRules, validate, adminController.createStore);
router.patch('/stores/:id', v.mongoIdParam('id'), v.storeUpdateRules, validate, adminController.updateStore);

// Products
router.get('/products', adminController.listProducts);
router.patch('/products/:id', v.mongoIdParam('id'), validate, adminController.updateProduct);
router.get('/store-products', adminController.listStoreProducts);
router.post('/store-products/import', v.importRules, validate, adminController.importStoreProduct);
router.post('/store-products/scrape-keyword', v.keywordScrapeRules, validate, adminController.scrapeByKeyword);
router.patch(
  '/store-products/:id',
  v.mongoIdParam('id'),
  v.storeProductUpdateRules,
  validate,
  adminController.updateStoreProduct
);
router.post('/products/refresh', adminController.refreshPrices);
router.post('/products/:productId/refresh', v.mongoIdParam('productId'), validate, adminController.refreshPrices);

// Background jobs (keyword scrape, full refresh, batch retry)
router.post('/affiliate/sync', adminController.syncAffiliate);
router.get('/affiliate/settings', adminController.affiliateSettings);
router.put('/affiliate/settings', adminController.updateAffiliateSettings);
router.get('/affiliate/status', adminController.affiliateStatus);
router.get('/affiliate/campaigns', adminController.listAffiliateCampaigns);
router.patch('/affiliate/campaigns/:id', v.mongoIdParam('id'), validate, adminController.updateAffiliateCampaign);
router.get('/affiliate/offers', adminController.listAffiliateOffers);
router.patch('/affiliate/offers/:id', v.mongoIdParam('id'), validate, adminController.updateAffiliateOffer);
router.get('/jobs', adminController.listJobs);
router.get('/jobs/:id', adminController.getJob);

// Monitoring / Scraper health
router.get('/monitoring/status', adminController.monitoringStatus);
router.post('/monitoring/run', adminController.runMonitorTick);
router.get('/monitoring/failed', adminController.failedChecks);
router.get('/scraper-health', adminController.scraperHealth);
router.post('/scraper-health/retry', adminController.retryScraper);
router.post(
  '/scraper-health/:storeProductId/retry',
  v.mongoIdParam('storeProductId'),
  validate,
  adminController.retryScraper
);

// Price history
router.get('/price-history', adminController.priceHistory);

// Notifications
router.get('/notifications', adminController.listNotifications);

// Deals
router.get('/deals', adminController.listDeals);
router.post('/deals', v.dealRules, validate, adminController.createDeal);
router.patch('/deals/:id', v.mongoIdParam('id'), v.dealUpdateRules, validate, adminController.updateDeal);

module.exports = router;
