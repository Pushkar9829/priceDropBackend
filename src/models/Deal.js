const mongoose = require('mongoose');

const dealSchema = new mongoose.Schema(
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
    },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: '',
    },
    previousPrice: Number,
    currentPrice: Number,
    discountPercent: Number,
    dropSeverity: {
      type: String,
      enum: ['NORMAL', 'SIGNIFICANT', 'MAJOR', 'HISTORICAL_LOW'],
      default: 'NORMAL',
    },
    isHistoricalLow: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

const Deal = mongoose.model('Deal', dealSchema);

module.exports = Deal;
