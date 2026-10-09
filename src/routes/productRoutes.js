const express = require('express');
const productController = require('../controllers/productController');
const { optionalAuth, protect, adminOnly } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { searchRules, priceHistoryQueryRules, mongoIdParam } = require('../middleware/validators');

const router = express.Router();

// Live store scraping is expensive — only admins may trigger it via ?live=1
const liveSearchGuard = (req, res, next) => {
  const live = req.query.live === '1' || req.query.live === 'true';
  if (!live) return next();
  return protect(req, res, (err) => (err ? next(err) : adminOnly(req, res, next)));
};

router.get('/search', searchRules, validate, liveSearchGuard, productController.search);
router.get('/categories', productController.categories);
router.get('/stores', productController.listStores);
router.get('/:id', mongoIdParam('id'), validate, optionalAuth, productController.getById);
router.get('/:id/similar', mongoIdParam('id'), validate, productController.similar);
router.get('/:id/comparison', mongoIdParam('id'), validate, productController.getComparison);
router.get(
  '/:id/price-history',
  mongoIdParam('id'),
  priceHistoryQueryRules,
  validate,
  productController.getPriceHistory
);

module.exports = router;
