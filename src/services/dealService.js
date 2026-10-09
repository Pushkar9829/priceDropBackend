const { Deal, StoreProduct, Product } = require('../models');
const AppError = require('../utils/AppError');

const DEAL_FIELDS = ['title', 'description', 'discountPercent', 'dropSeverity', 'isActive', 'expiresAt'];

const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

const listDeals = async ({ page = 1, limit = 20 } = {}) => {
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (page - 1) * limit;
  const filter = {
    isActive: true,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  };

  const [items, total] = await Promise.all([
    Deal.find(filter)
      .populate({ path: 'productId', select: 'title brand images slug', match: { isActive: true } })
      .populate({ path: 'storeId', select: 'name slug logo domain', match: { isActive: true } })
      .populate({ path: 'storeProductId', select: 'productUrl affiliateUrl currentPrice', match: { isActive: true } })
      .sort({ discountPercent: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Deal.countDocuments(filter),
  ]);

  // Safety net: toggles deactivate deals (deactivateDealsFor), but never show one whose
  // product, store or listing is no longer active
  const visible = items.filter((d) => d.productId && d.storeId && d.storeProductId);
  return { items: visible, total, page, limit, pages: Math.ceil(total / limit) || 1 };
};

/** End active deals matching a filter (product/listing/store switched off). */
const deactivateDealsFor = (filter) =>
  Deal.updateMany({ ...filter, isActive: true }, { $set: { isActive: false } });

const createDeal = async (payload) => {
  const product = await Product.findById(payload.productId);
  if (!product) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');

  const storeProduct = await StoreProduct.findOne({
    _id: payload.storeProductId,
    productId: payload.productId,
  });
  if (!storeProduct) {
    throw new AppError('Store product not found for this product', 404, 'STORE_PRODUCT_NOT_FOUND');
  }

  const previousPrice = storeProduct.previousPrice ?? storeProduct.mrp ?? null;
  const computedPct =
    previousPrice && previousPrice > storeProduct.currentPrice
      ? Math.round(((previousPrice - storeProduct.currentPrice) / previousPrice) * 100)
      : 0;

  // One active deal per listing — a manual deal replaces the automatic one
  await deactivateDealsFor({ storeProductId: storeProduct._id });
  return Deal.create({
    ...pick(payload, DEAL_FIELDS),
    productId: product._id,
    storeProductId: storeProduct._id,
    storeId: storeProduct.storeId,
    currentPrice: storeProduct.currentPrice,
    previousPrice,
    discountPercent: payload.discountPercent ?? computedPct,
    isActive: true,
  });
};

const updateDeal = async (id, updates) => {
  const patch = pick(updates, DEAL_FIELDS);
  if (!Object.keys(patch).length) throw new AppError('No valid fields to update', 400, 'EMPTY_UPDATE');
  const deal = await Deal.findByIdAndUpdate(id, patch, { new: true, runValidators: true })
    .populate('productId', 'title brand')
    .populate('storeId', 'name slug');
  if (!deal) throw new AppError('Deal not found', 404, 'DEAL_NOT_FOUND');
  return deal;
};

module.exports = { listDeals, createDeal, updateDeal, deactivateDealsFor };
