const mongoose = require('mongoose');

const SCRAPE_STATUSES = ['pending', 'running', 'done', 'failed', 'skipped'];

const brandSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    searchKeyword: {
      type: String,
      required: true,
      trim: true,
    },
    scrapeStatus: {
      type: String,
      enum: SCRAPE_STATUSES,
      default: 'pending',
      index: true,
    },
    lastScrapedAt: {
      type: Date,
      default: null,
    },
    lastError: {
      type: String,
      default: '',
    },
    amazonFound: {
      type: Number,
      default: 0,
    },
    flipkartFound: {
      type: Number,
      default: 0,
    },
    savedCount: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

brandSchema.index({ scrapeStatus: 1, isActive: 1 });

module.exports = mongoose.model('Brand', brandSchema);
module.exports.SCRAPE_STATUSES = SCRAPE_STATUSES;
