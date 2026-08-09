const { Store } = require('../models');
const { createIntegration } = require('../integrations');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * Returns active store documents with their store adapters.
 */
const getActiveIntegrations = async () => {
  const stores = await Store.find({ isActive: true });
  return stores
    .map((store) => {
      const integration = createIntegration(store);
      return integration ? { store, integration } : null;
    })
    .filter(Boolean);
};

/**
 * Search across all active store adapters.
 */
const searchAllStores = async (query, options = {}) => {
  const integrations = await getActiveIntegrations();
  const results = [];

  await Promise.all(
    integrations.map(async ({ store, integration }) => {
      try {
        const items = await integration.searchProducts(query, options);
        items.forEach((item) => {
          results.push({
            ...item,
            storeId: store._id,
            storeSlug: store.slug,
            storeName: store.name,
          });
        });
      } catch (err) {
        logger.error('Store search failed', {
          store: store.slug,
          error: err.message,
        });
      }
    })
  );

  return results;
};

/**
 * Fetch current price for a store product via its store adapter.
 * Passes productUrl so HTTP/Playwright strategies can use it.
 */
const fetchPriceForStoreProduct = async (storeProduct) => {
  const store = await Store.findById(storeProduct.storeId);
  if (!store || !store.isActive) {
    throw new AppError('Store inactive or missing', 400, 'STORE_INACTIVE');
  }

  const integration = createIntegration(store);
  if (!integration) {
    throw new AppError('No integration for store', 500, 'NO_INTEGRATION');
  }

  return integration.getCurrentPrice(storeProduct.externalProductId, {
    productUrl: storeProduct.productUrl,
  });
};

/**
 * Fetch full normalized product details from a store adapter.
 */
const fetchProductDetails = async (store, externalProductId, options = {}) => {
  const integration = createIntegration(store);
  if (!integration) return null;
  return integration.getProductDetails(externalProductId, options);
};

module.exports = {
  getActiveIntegrations,
  searchAllStores,
  fetchPriceForStoreProduct,
  fetchProductDetails,
};
