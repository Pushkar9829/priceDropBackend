const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { PriceAlert, ALERT_STATUS, Product, StoreProduct } = require('../models');
const notificationService = require('./notificationService');
const { outboundUrl } = require('../utils/affiliate');

const triggerAlertNotification = async (alert, context) => {
  // Atomic claim — prevents duplicate notifies under concurrent store checks
  const claimed = await PriceAlert.findOneAndUpdate(
    {
      _id: alert._id,
      notifiedBelowTarget: false,
      status: { $in: [ALERT_STATUS.ACTIVE, ALERT_STATUS.TRIGGERED] },
    },
    {
      $set: {
        notifiedBelowTarget: true,
        lastNotifiedAt: new Date(),
        status: ALERT_STATUS.TRIGGERED,
        currentPrice: context.currentPrice,
      },
    },
    { new: true }
  );

  if (!claimed) {
    return null;
  }

  try {
    const result = await notificationService.sendPriceAlertNotification({
      userId: alert.userId,
      productId: alert.productId,
      storeProductId: context.storeProductId || alert.storeProductId,
      title: context.title || 'Product',
      currentPrice: context.currentPrice,
      previousPrice: context.previousPrice,
      targetPrice: alert.targetPrice,
      alertId: alert._id,
      productUrl: context.productUrl,
      storeName: context.storeName,
    });

    if (!result?.anySent) {
      // Roll back claim so a later check can retry
      await PriceAlert.findByIdAndUpdate(alert._id, {
        notifiedBelowTarget: false,
        status: ALERT_STATUS.ACTIVE,
        lastNotifiedAt: null,
      });
      logger.warn('Alert notification failed; re-armed for retry', { alertId: alert._id });
      return null;
    }

    logger.info('Alert triggered', {
      alertId: alert._id,
      userId: alert.userId,
      currentPrice: context.currentPrice,
      targetPrice: alert.targetPrice,
    });

    return claimed;
  } catch (err) {
    await PriceAlert.findByIdAndUpdate(alert._id, {
      notifiedBelowTarget: false,
      status: ALERT_STATUS.ACTIVE,
      lastNotifiedAt: null,
    });
    throw err;
  }
};

const MAX_LIVE_ALERTS_PER_USER = 200;
const LIVE_STATUSES = [ALERT_STATUS.ACTIVE, ALERT_STATUS.TRIGGERED, ALERT_STATUS.PAUSED];

const createAlert = async (userId, { productId, storeProductId, targetPrice }) => {
  const product = await Product.findById(productId).select('title isActive priceSummary').lean();
  if (!product || !product.isActive) {
    throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  }

  let listing = null;
  if (storeProductId) {
    listing = await StoreProduct.findOne({ _id: storeProductId, productId, isActive: true }).lean();
    if (!listing) {
      throw new AppError('Store product not found for this product', 404, 'STORE_PRODUCT_NOT_FOUND');
    }
  }

  // One live alert per user + product + scope: setting it again just moves the target
  const scope = { userId, productId, storeProductId: storeProductId || null };
  const existing = await PriceAlert.findOne({ ...scope, status: { $in: LIVE_STATUSES } });
  if (existing) {
    return updateAlert(userId, existing._id, { targetPrice, status: ALERT_STATUS.ACTIVE });
  }

  // Each alert makes its product HOT (30-min checks) — cap so one account can't flood the scraper
  if ((await PriceAlert.countDocuments({ userId, status: { $in: LIVE_STATUSES } })) >= MAX_LIVE_ALERTS_PER_USER) {
    throw new AppError(`You can have up to ${MAX_LIVE_ALERTS_PER_USER} alerts. Remove some to add more.`, 400, 'ALERT_LIMIT');
  }

  let alert;
  try {
    alert = await PriceAlert.create({
      ...scope,
      targetPrice,
      currentPrice: listing ? (listing.availability !== 'OUT_OF_STOCK' ? listing.currentPrice : null) : product.priceSummary?.lowestPrice ?? null,
      status: ALERT_STATUS.ACTIVE,
      notifiedBelowTarget: false,
    });
  } catch (err) {
    // Double submit raced past the findOne — the unique index caught it; update instead
    if (err.code === 11000) {
      const dup = await PriceAlert.findOne({ ...scope, status: { $in: LIVE_STATUSES } });
      if (dup) return updateAlert(userId, dup._id, { targetPrice, status: ALERT_STATUS.ACTIVE });
    }
    throw err;
  }

  require('./priceMonitoringService').promoteToHot(productId).catch(() => {});
  // Same price source as the monitor (fires now if the target is already met)
  await evaluateAlertsForProduct(productId);
  return PriceAlert.findById(alert._id);
};

const listAlerts = async (userId) =>
  PriceAlert.find({ userId, status: { $ne: ALERT_STATUS.CANCELLED } })
    .populate('productId', 'title brand images slug')
    .populate({
      path: 'storeProductId',
      select: 'title currentPrice availability storeId',
      populate: { path: 'storeId', select: 'name slug' },
    })
    .sort({ createdAt: -1 })
    .lean()
    .then((rows) => rows.filter((a) => a.productId));

const updateAlert = async (userId, alertId, updates) => {
  const alert = await PriceAlert.findOne({ _id: alertId, userId });
  // A cancelled (deleted) alert can't be revived — it could sit beside a newer alert
  if (!alert || alert.status === ALERT_STATUS.CANCELLED) {
    throw new AppError('Price alert not found', 404, 'ALERT_NOT_FOUND');
  }

  if (updates.targetPrice != null) {
    alert.targetPrice = updates.targetPrice;
    alert.notifiedBelowTarget = false;
    if (alert.status === ALERT_STATUS.TRIGGERED) {
      alert.status = ALERT_STATUS.ACTIVE;
    }
  }

  if (updates.status) {
    const allowed = [ALERT_STATUS.ACTIVE, ALERT_STATUS.PAUSED, ALERT_STATUS.CANCELLED];
    if (!allowed.includes(updates.status)) {
      throw new AppError('Invalid status', 400, 'INVALID_STATUS');
    }
    alert.status = updates.status;
    if (updates.status === ALERT_STATUS.ACTIVE) {
      alert.notifiedBelowTarget = false;
    }
  }

  await alert.save();

  // Re-check against the live price (same logic as the monitor) — fires if already met
  if (alert.status === ALERT_STATUS.ACTIVE) {
    await evaluateAlertsForProduct(alert.productId);
    return PriceAlert.findById(alert._id);
  }
  return alert;
};

const deleteAlert = async (userId, alertId) => {
  const alert = await PriceAlert.findOne({ _id: alertId, userId });
  if (!alert) {
    throw new AppError('Price alert not found', 404, 'ALERT_NOT_FOUND');
  }
  alert.status = ALERT_STATUS.CANCELLED;
  await alert.save();
  return alert;
};

/**
 * Re-evaluate every live alert on a product after any of its listings changed.
 *
 * The comparison price depends on the alert's scope:
 *   - store-specific alert → that listing's price (ignored while out of stock)
 *   - "any store" alert    → the product's current lowest in-stock price
 * Comparing "any store" alerts against whichever listing happened to change would
 * re-arm or double-notify incorrectly when several stores move independently.
 */
const evaluateAlertsForProduct = async (productId, { changedStoreProductId = null, previousPrice = null } = {}) => {
  const alerts = await PriceAlert.find({
    productId,
    status: { $in: [ALERT_STATUS.ACTIVE, ALERT_STATUS.TRIGGERED] },
  });
  if (!alerts.length) return;

  const [product, listings] = await Promise.all([
    Product.findById(productId).select('title isActive priceSummary').lean(),
    StoreProduct.find({ productId, isActive: true }).populate('storeId', 'name slug isActive'),
  ]);
  // Hidden products don't notify — the link would 404
  if (!product?.isActive) return;
  const byId = new Map(listings.map((l) => [String(l._id), l]));
  const inStock = (l) =>
    l && l.storeId?.isActive !== false && l.availability !== 'OUT_OF_STOCK' && l.currentPrice > 0;
  const best = byId.get(String(product?.priceSummary?.bestStoreProductId));

  for (const alert of alerts) {
    try {
      const listing = alert.storeProductId ? byId.get(String(alert.storeProductId)) : best;
      const price = alert.storeProductId
        ? inStock(listing)
          ? listing.currentPrice
          : null
        : product?.priceSummary?.lowestPrice ?? null;

      if (price == null) continue; // nothing buyable right now — leave the alert as is

      if (price > alert.targetPrice) {
        await PriceAlert.updateOne(
          { _id: alert._id },
          alert.notifiedBelowTarget
            ? { $set: { currentPrice: price, notifiedBelowTarget: false, status: ALERT_STATUS.ACTIVE } }
            : { $set: { currentPrice: price } }
        );
        continue;
      }

      if (!alert.notifiedBelowTarget) {
        await triggerAlertNotification(alert, {
          currentPrice: price,
          previousPrice: listing && String(listing._id) === String(changedStoreProductId) ? previousPrice : null,
          title: product?.title || listing?.title || 'Product',
          productUrl: outboundUrl(listing, 'price_alert'),
          storeName: listing?.storeId?.name || '',
          storeProductId: listing?._id || null,
        });
      } else if (alert.currentPrice !== price) {
        await PriceAlert.updateOne({ _id: alert._id }, { $set: { currentPrice: price } });
      }
    } catch (err) {
      logger.error('Failed processing alert', { alertId: alert._id, error: err.message });
    }
  }
};

/** @deprecated kept for older callers — evaluates the whole product. */
const checkAlertsForPriceChange = ({ productId, storeProductId, previousPrice }) =>
  evaluateAlertsForProduct(productId, { changedStoreProductId: storeProductId, previousPrice });

module.exports = {
  createAlert,
  listAlerts,
  updateAlert,
  deleteAlert,
  checkAlertsForPriceChange,
  evaluateAlertsForProduct,
};
