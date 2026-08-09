const mongoose = require('mongoose');

const INTEGRATION_TYPES = Object.freeze({
  MOCK: 'MOCK',
  DEMO_FEED: 'DEMO_FEED',
  AFFILIATE_API: 'AFFILIATE_API',
  MERCHANT_API: 'MERCHANT_API',
  PRODUCT_FEED: 'PRODUCT_FEED',
  OFFICIAL_API: 'OFFICIAL_API',
  HTTP_HTML: 'HTTP_HTML',
  PLAYWRIGHT: 'PLAYWRIGHT',
});

const storeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    domain: {
      type: String,
      required: true,
      trim: true,
    },
    logo: {
      type: String,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    integrationType: {
      type: String,
      enum: Object.values(INTEGRATION_TYPES),
      default: INTEGRATION_TYPES.DEMO_FEED,
    },
    config: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

const Store = mongoose.model('Store', storeSchema);

module.exports = { Store, INTEGRATION_TYPES };
