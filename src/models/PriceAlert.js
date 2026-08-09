const mongoose = require('mongoose');

const ALERT_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  TRIGGERED: 'TRIGGERED',
  PAUSED: 'PAUSED',
  CANCELLED: 'CANCELLED',
});

const priceAlertSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    storeProductId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StoreProduct',
      default: null,
    },
    targetPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    currentPrice: {
      type: Number,
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(ALERT_STATUS),
      default: ALERT_STATUS.ACTIVE,
      index: true,
    },
    lastNotifiedAt: {
      type: Date,
      default: null,
    },
    /** Used for duplicate prevention: reset when price goes back above target */
    notifiedBelowTarget: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

priceAlertSchema.index({ productId: 1, status: 1 });
priceAlertSchema.index({ storeProductId: 1, status: 1 });

const PriceAlert = mongoose.model('PriceAlert', priceAlertSchema);

module.exports = { PriceAlert, ALERT_STATUS };
