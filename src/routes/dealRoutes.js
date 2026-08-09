const express = require('express');
const dealController = require('../controllers/dealController');

const router = express.Router();

router.get('/', dealController.list);

module.exports = router;
