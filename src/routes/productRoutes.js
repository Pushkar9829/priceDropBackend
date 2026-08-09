const express = require('express');
const productController = require('../controllers/productController');
const validate = require('../middleware/validate');
const { searchRules, mongoIdParam } = require('../middleware/validators');

const router = express.Router();

router.get('/search', searchRules, validate, productController.search);
router.get('/:id', mongoIdParam('id'), validate, productController.getById);
router.get('/:id/comparison', mongoIdParam('id'), validate, productController.getComparison);
router.get('/:id/price-history', mongoIdParam('id'), validate, productController.getPriceHistory);

module.exports = router;
