const express = require('express');
const watchlistController = require('../controllers/watchlistController');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { mongoIdParam } = require('../middleware/validators');

const router = express.Router();

router.use(protect);

router.get('/', watchlistController.list);
router.post('/:productId', mongoIdParam('productId'), validate, watchlistController.add);
router.delete('/:productId', mongoIdParam('productId'), validate, watchlistController.remove);

module.exports = router;
