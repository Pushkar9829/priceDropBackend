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

dealSchema.index({ storeProductId: 1, isActive: 1 });
// At most one active deal per listing (concurrent writers can't create duplicates)
dealSchema.index(
  { storeProductId: 1 },
  { unique: true, partialFilterExpression: { isActive: true }, name: 'one_active_deal_per_listing' }
);
dealSchema.index({ isActive: 1, discountPercent: -1, createdAt: -1 });
dealSchema.index({ isActive: 1, expiresAt: 1 });

const Deal = mongoose.model('Deal', dealSchema);

module.exports = Deal;
