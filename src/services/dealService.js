const { Deal, StoreProduct, Product } = require('../models');
const AppError = require('../utils/AppError');

const listDeals = async ({ page = 1, limit = 20 } = {}) => {
  const skip = (page - 1) * limit;
  const filter = {
    isActive: true,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  };

  const [items, total] = await Promise.all([
    Deal.find(filter)
      .populate('productId', 'title brand images slug')
      .populate('storeId', 'name slug logo')
      .populate('storeProductId', 'productUrl affiliateUrl currentPrice')
      .sort({ discountPercent: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Deal.countDocuments(filter),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) };
};

const createDeal = async (payload) => {
  const product = await Product.findById(payload.productId);
  if (!product) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');

  const storeProduct = await StoreProduct.findById(payload.storeProductId);
  if (!storeProduct) throw new AppError('Store product not found', 404, 'STORE_PRODUCT_NOT_FOUND');

  return Deal.create({
    ...payload,
    storeId: payload.storeId || storeProduct.storeId,
    currentPrice: payload.currentPrice ?? storeProduct.currentPrice,
    previousPrice: payload.previousPrice ?? storeProduct.previousPrice,
    isActive: true,
  });
};

const updateDeal = async (id, updates) => {
  const deal = await Deal.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
  if (!deal) throw new AppError('Deal not found', 404, 'DEAL_NOT_FOUND');
  return deal;
};

module.exports = { listDeals, createDeal, updateDeal };
