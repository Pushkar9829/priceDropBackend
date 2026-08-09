const express = require('express');
const priceAlertController = require('../controllers/priceAlertController');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { priceAlertRules, mongoIdParam } = require('../middleware/validators');

const router = express.Router();

router.use(protect);

router.post('/', priceAlertRules, validate, priceAlertController.create);
router.get('/', priceAlertController.list);
router.patch('/:id', mongoIdParam('id'), validate, priceAlertController.update);
router.delete('/:id', mongoIdParam('id'), validate, priceAlertController.remove);

module.exports = router;
