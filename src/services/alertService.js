const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { PriceAlert, ALERT_STATUS, Product, StoreProduct } = require('../models');
const notificationService = require('./notificationService');

const resolveListingContext = async (productId, storeProductId) => {
  let listing = null;
  if (storeProductId) {
    listing = await StoreProduct.findById(storeProductId).populate('storeId', 'name slug');
  }
  if (!listing) {
    listing = await StoreProduct.findOne({
      productId,
      isActive: true,
      availability: { $ne: 'OUT_OF_STOCK' },
    })
      .sort({ currentPrice: 1 })
      .populate('storeId', 'name slug');
  }

  return {
    currentPrice: listing?.currentPrice ?? null,
    productUrl: listing?.productUrl || '',
    storeName: listing?.storeId?.name || '',
    storeProductId: listing?._id || storeProductId || null,
  };
};

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

const createAlert = async (userId, { productId, storeProductId, targetPrice }) => {
  const product = await Product.findById(productId);
  if (!product || !product.isActive) {
    throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  }

  if (storeProductId) {
    const sp = await StoreProduct.findOne({ _id: storeProductId, productId });
    if (!sp) {
      throw new AppError('Store product not found for this product', 404, 'STORE_PRODUCT_NOT_FOUND');
    }
  }

  const ctx = await resolveListingContext(productId, storeProductId || null);

  let alert = await PriceAlert.create({
    userId,
    productId,
    storeProductId: storeProductId || null,
    targetPrice,
    currentPrice: ctx.currentPrice,
    status: ALERT_STATUS.ACTIVE,
    notifiedBelowTarget: false,
  });

  // Fire immediately if already at/below target
  if (ctx.currentPrice != null && ctx.currentPrice <= targetPrice) {
    await triggerAlertNotification(alert, {
      ...ctx,
      title: product.title,
      previousPrice: null,
    });
    alert = await PriceAlert.findById(alert._id);
  }

  return alert;
};

const listAlerts = async (userId) =>
  PriceAlert.find({ userId, status: { $ne: ALERT_STATUS.CANCELLED } })
    .populate('productId', 'title brand images slug')
    .populate('storeProductId', 'title currentPrice storeId')
    .sort({ createdAt: -1 });

const updateAlert = async (userId, alertId, updates) => {
  const alert = await PriceAlert.findOne({ _id: alertId, userId });
  if (!alert) {
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

  // Re-evaluate if target now already met
  if (
    alert.status === ALERT_STATUS.ACTIVE &&
    !alert.notifiedBelowTarget &&
    alert.currentPrice != null &&
    alert.currentPrice <= alert.targetPrice
  ) {
    const product = await Product.findById(alert.productId);
    const ctx = await resolveListingContext(alert.productId, alert.storeProductId);
    await triggerAlertNotification(alert, {
      ...ctx,
      title: product?.title || 'Product',
      previousPrice: null,
      currentPrice: alert.currentPrice,
    });
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
 * Called by price monitoring when a price changes.
 */
const checkAlertsForPriceChange = async ({
  productId,
  storeProductId,
  currentPrice,
  previousPrice,
  title,
}) => {
  const storeProduct = storeProductId
    ? await StoreProduct.findById(storeProductId).populate('storeId', 'name slug')
    : null;

  const alerts = await PriceAlert.find({
    productId,
    status: { $in: [ALERT_STATUS.ACTIVE, ALERT_STATUS.TRIGGERED] },
    $or: [{ storeProductId: null }, { storeProductId }],
  });

  for (const alert of alerts) {
    try {
      const belowTarget = currentPrice <= alert.targetPrice;
      const aboveTarget = currentPrice > alert.targetPrice;

      if (aboveTarget && alert.notifiedBelowTarget) {
        await PriceAlert.findOneAndUpdate(
          {
            _id: alert._id,
            notifiedBelowTarget: true,
          },
          {
            $set: {
              currentPrice,
              notifiedBelowTarget: false,
              status: ALERT_STATUS.ACTIVE,
            },
          }
        );
        continue;
      }

      if (belowTarget && !alert.notifiedBelowTarget) {
        await triggerAlertNotification(alert, {
          currentPrice,
          previousPrice,
          title: title || storeProduct?.title || 'Product',
          productUrl: storeProduct?.productUrl || '',
          storeName: storeProduct?.storeId?.name || '',
          storeProductId,
        });
      } else {
        await PriceAlert.findByIdAndUpdate(alert._id, { currentPrice });
      }
    } catch (err) {
      logger.error('Failed processing alert', {
        alertId: alert._id,
        error: err.message,
      });
    }
  }
};

module.exports = {
  createAlert,
  listAlerts,
  updateAlert,
  deleteAlert,
  checkAlertsForPriceChange,
};
