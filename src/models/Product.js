const mongoose = require('mongoose');

const identifierSchema = new mongoose.Schema(
  {
    sku: String,
    asin: String,
    gtin: String,
    isbn: String,
    mpn: String,
    modelNumber: String,
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    brand: {
      type: String,
      trim: true,
      index: true,
    },
    category: {
      type: String,
      trim: true,
      index: true,
    },
    subCategory: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    images: {
      type: [String],
      default: [],
    },
    identifiers: {
      type: identifierSchema,
      default: {},
    },
    attributes: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },
    variants: {
      type: [
        {
          name: String,
          value: String,
        },
      ],
      default: [],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    normalizedTitle: {
      type: String,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    /**
     * Denormalized price summary across active listings of active stores.
     * Maintained by productSummaryService on every listing change so catalog reads
     * (search, price sort, brands, deals) never aggregate listings at request time.
     */
    priceSummary: {
      lowestPrice: { type: Number, default: null },
      /** lowestPrice, or a sentinel when nothing is buyable — ascending price sorts put those last */
      sortPrice: { type: Number, default: null },
      highestPrice: { type: Number, default: null },
      mrp: { type: Number, default: null },
      discountPercent: { type: Number, default: null },
      storeCount: { type: Number, default: 0 },
      inStockCount: { type: Number, default: 0 },
      bestStoreProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'StoreProduct', default: null },
      lastCheckedAt: { type: Date, default: null },
      updatedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

productSchema.index({ brand: 1, 'identifiers.modelNumber': 1 });
productSchema.index({ category: 1, brand: 1 });
productSchema.index({ isActive: 1, brand: 1, updatedAt: -1 });
productSchema.index({ isActive: 1, updatedAt: -1 });
productSchema.index({ title: 'text', brand: 'text', normalizedTitle: 'text' });
productSchema.index({ isActive: 1, 'priceSummary.sortPrice': 1 });
productSchema.index({ isActive: 1, 'priceSummary.lowestPrice': -1 });
productSchema.index({ isActive: 1, 'priceSummary.discountPercent': -1 });
productSchema.index({ isActive: 1, brand: 1, 'priceSummary.discountPercent': -1 });
productSchema.index({ isActive: 1, category: 1, 'priceSummary.lowestPrice': 1 });
productSchema.index({ 'priceSummary.updatedAt': 1 });
productSchema.index({ isActive: 1, 'priceSummary.lastCheckedAt': -1 });

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
