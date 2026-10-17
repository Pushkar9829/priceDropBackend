const mongoose = require('mongoose');

const AVAILABILITY = Object.freeze({
  IN_STOCK: 'IN_STOCK',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  UNKNOWN: 'UNKNOWN',
  PREORDER: 'PREORDER',
});

const SCRAPE_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  TEMPORARILY_UNAVAILABLE: 'TEMPORARILY_UNAVAILABLE',
});

const storeProductSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
      index: true,
    },
    externalProductId: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    productUrl: {
      type: String,
      required: true,
    },
    affiliateUrl: {
      type: String,
      default: '',
    },
    seller: {
      type: String,
      default: '',
    },
    currentPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    previousPrice: {
      type: Number,
      default: null,
    },
    mrp: {
      type: Number,
      default: null,
    },
    discount: {
      type: Number,
      default: 0,
    },
    currency: {
      type: String,
      default: 'INR',
    },
    availability: {
      type: String,
      enum: Object.values(AVAILABILITY),
      default: AVAILABILITY.UNKNOWN,
    },
    rating: {
      type: Number,
      default: null,
      min: 0,
      max: 5,
    },
    reviewCount: {
      type: Number,
      default: 0,
    },
    images: {
      type: [String],
      default: [],
    },
    variant: {
      type: Map,
      of: String,
      default: {},
    },
    lastCheckedAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastSuccessfulFetchAt: {
      type: Date,
      default: null,
    },
    lastFailedFetchAt: {
      type: Date,
      default: null,
    },
    scrapeStatus: {
      type: String,
      enum: Object.values(SCRAPE_STATUS),
      default: SCRAPE_STATUS.PENDING,
      index: true,
    },
    consecutiveFailureCount: {
      type: Number,
      default: 0,
    },
    lastError: {
      type: String,
      default: null,
    },
    /** @deprecated use scrapeStatus — kept for backward compatibility */
    lastCheckStatus: {
      type: String,
      enum: ['SUCCESS', 'FAILED', 'PENDING'],
      default: 'PENDING',
    },
    lastCheckError: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    /** All-time extremes for this listing — avoids scanning history on every change. */
    lowestEverPrice: { type: Number, default: null },
    highestEverPrice: { type: Number, default: null },
    /** A big price swing seen once and awaiting confirmation by the next check. */
    suspectPrice: { type: Number, default: null },
    /** When the scheduler should check this listing next (null = as soon as possible). */
    nextCheckAt: { type: Date, default: null },
    /** Demand tier at last scheduling: HOT (alerts/watchers), NORMAL, COLD. */
    monitorTier: { type: String, enum: ['HOT', 'NORMAL', 'COLD'], default: 'NORMAL' },
  },
  { timestamps: true }
);

storeProductSchema.index({ productId: 1, storeId: 1 }, { unique: true });
storeProductSchema.index({ storeId: 1, externalProductId: 1 }, { unique: true });
storeProductSchema.index({ lastCheckedAt: 1, isActive: 1 });
storeProductSchema.index({ scrapeStatus: 1, consecutiveFailureCount: -1 });
storeProductSchema.index({ storeId: 1, scrapeStatus: 1 });
storeProductSchema.index({ isActive: 1, nextCheckAt: 1 });
storeProductSchema.index({ productId: 1, isActive: 1, currentPrice: 1 });

const StoreProduct = mongoose.model('StoreProduct', storeProductSchema);

module.exports = { StoreProduct, AVAILABILITY, SCRAPE_STATUS };
