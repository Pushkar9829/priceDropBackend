const express = require('express');
const offerController = require('../controllers/offerController');

const router = express.Router();

router.get('/', offerController.list);
router.get('/stores', offerController.stores);
router.get('/stores/:slug', offerController.store);
router.get('/for-domain', offerController.forDomain);

module.exports = router;
