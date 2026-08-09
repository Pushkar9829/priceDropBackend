const AmazonAdapter = require('./amazon/amazon.adapter');
const FlipkartAdapter = require('./flipkart/flipkart.adapter');
const MyntraAdapter = require('./myntra/myntra.adapter');
const CromaAdapter = require('./croma/croma.adapter');
const logger = require('../../utils/logger');

const ADAPTERS = {
  amazon: AmazonAdapter,
  flipkart: FlipkartAdapter,
  myntra: MyntraAdapter,
  croma: CromaAdapter,
};

/**
 * Scraper Manager — resolves the correct store adapter.
 * Product / monitoring services talk only to this layer.
 */
class ScraperManager {
  createAdapter(store) {
    if (!store || !store.isActive) return null;

    const AdapterClass = ADAPTERS[store.slug];
    if (!AdapterClass) {
      logger.warn('No store adapter registered', { slug: store.slug });
      return null;
    }

    return new AdapterClass(store);
  }

  listSupportedStores() {
    return Object.keys(ADAPTERS);
  }
}

module.exports = new ScraperManager();
