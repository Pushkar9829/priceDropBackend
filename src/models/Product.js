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
  },
  { timestamps: true }
);

productSchema.index({ brand: 1, 'identifiers.modelNumber': 1 });
productSchema.index({ category: 1, brand: 1 });
productSchema.index({ isActive: 1, brand: 1, updatedAt: -1 });
productSchema.index({ isActive: 1, updatedAt: -1 });
productSchema.index({ title: 'text', brand: 'text', normalizedTitle: 'text' });

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
