const express = require('express');
const mongoose = require('mongoose');
const authRoutes = require('./authRoutes');
const productRoutes = require('./productRoutes');
const watchlistRoutes = require('./watchlistRoutes');
const priceAlertRoutes = require('./priceAlertRoutes');
const notificationRoutes = require('./notificationRoutes');
const dealRoutes = require('./dealRoutes');
const brandRoutes = require('./brandRoutes');
const adminRoutes = require('./adminRoutes');
const internalRoutes = require('./internalRoutes');
const offerRoutes = require('./offerRoutes');
const { getSitemap } = require('../controllers/sitemapController');

const router = express.Router();

router.get('/health', (req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.status(dbUp ? 200 : 503).json({
    success: dbUp,
    message: dbUp ? 'OK' : 'Database unavailable',
    db: dbUp ? 'up' : 'down',
    timestamp: new Date().toISOString(),
  });
});

// Public XML sitemap (the website proxies /sitemap.xml here)
router.get('/sitemap.xml', getSitemap);

router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/watchlist', watchlistRoutes);
router.use('/price-alerts', priceAlertRoutes);
router.use('/notifications', notificationRoutes);
router.use('/deals', dealRoutes);
router.use('/brands', brandRoutes);
router.use('/offers', offerRoutes);
router.get('/site-config', require('../controllers/offerController').siteConfig);
router.get('/travel', require('../controllers/offerController').travel);
router.use('/admin', adminRoutes);
router.use('/internal', internalRoutes);

module.exports = router;
