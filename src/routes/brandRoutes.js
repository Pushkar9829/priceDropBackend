const express = require('express');
const brandController = require('../controllers/brandController');

const router = express.Router();

router.get('/top', brandController.top);
router.get('/categories', brandController.categories);

module.exports = router;
