const mongoose = require('mongoose');

const priceHistorySchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    storeProductId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StoreProduct',
      required: true,
      index: true,
    },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
      index: true,
    },
    previousPrice: {
      type: Number,
      default: null,
    },
    newPrice: {
      type: Number,
      required: true,
    },
    priceDifference: {
      type: Number,
      default: null,
    },
    percentageChange: {
      type: Number,
      default: null,
    },
    availability: {
      type: String,
      default: 'UNKNOWN',
    },
    changeType: {
      type: String,
      enum: ['INCREASE', 'DECREASE', 'UNCHANGED', 'INITIAL', 'AVAILABILITY_CHANGE'],
      default: 'INITIAL',
    },
    isHistoricalLow: {
      type: Boolean,
      default: false,
    },
    dropSeverity: {
      type: String,
      enum: ['NONE', 'NORMAL', 'SIGNIFICANT', 'MAJOR', 'HISTORICAL_LOW'],
      default: 'NONE',
    },
    recordedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: false }
);

// Append-only: no updates expected
priceHistorySchema.index({ productId: 1, recordedAt: -1 });
priceHistorySchema.index({ storeProductId: 1, recordedAt: -1 });

const PriceHistory = mongoose.model('PriceHistory', priceHistorySchema);

module.exports = PriceHistory;
