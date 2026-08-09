const express = require('express');
const authRoutes = require('./authRoutes');
const productRoutes = require('./productRoutes');
const watchlistRoutes = require('./watchlistRoutes');
const priceAlertRoutes = require('./priceAlertRoutes');
const notificationRoutes = require('./notificationRoutes');
const dealRoutes = require('./dealRoutes');
const brandRoutes = require('./brandRoutes');
const adminRoutes = require('./adminRoutes');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ success: true, message: 'OK', timestamp: new Date().toISOString() });
});

router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/watchlist', watchlistRoutes);
router.use('/price-alerts', priceAlertRoutes);
router.use('/notifications', notificationRoutes);
router.use('/deals', dealRoutes);
router.use('/brands', brandRoutes);
router.use('/admin', adminRoutes);

module.exports = router;
