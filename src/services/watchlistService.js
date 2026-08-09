const AppError = require('../utils/AppError');
const { Watchlist, Product, StoreProduct } = require('../models');

const addToWatchlist = async (userId, productId) => {
  const product = await Product.findById(productId);
  if (!product || !product.isActive) {
    throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  }

  const existing = await Watchlist.findOne({ userId, productId });
  if (existing) {
    return existing;
  }

  return Watchlist.create({ userId, productId });
};

const removeFromWatchlist = async (userId, productId) => {
  const item = await Watchlist.findOneAndDelete({ userId, productId });
  if (!item) {
    throw new AppError('Product not in watchlist', 404, 'NOT_IN_WATCHLIST');
  }
  return item;
};

const getWatchlist = async (userId) => {
  const items = await Watchlist.find({ userId })
    .populate('productId')
    .sort({ createdAt: -1 });

  const enriched = await Promise.all(
    items.map(async (item) => {
      if (!item.productId) return null;
      const storeProducts = await StoreProduct.find({
        productId: item.productId._id,
        isActive: true,
      }).populate('storeId', 'name slug logo');

      const prices = storeProducts
        .filter((sp) => sp.availability !== 'OUT_OF_STOCK')
        .map((sp) => sp.currentPrice);

      return {
        id: item._id,
        addedAt: item.createdAt,
        product: {
          id: item.productId._id,
          title: item.productId.title,
          brand: item.productId.brand,
          images: item.productId.images,
          slug: item.productId.slug,
          lowestPrice: prices.length ? Math.min(...prices) : null,
          storeCount: storeProducts.length,
        },
      };
    })
  );

  return enriched.filter(Boolean);
};

module.exports = { addToWatchlist, removeFromWatchlist, getWatchlist };
