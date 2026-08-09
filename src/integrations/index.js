const scraperManager = require('./stores/ScraperManager');

/**
 * Public integration entrypoint.
 * Business services must not import store-specific scrapers directly.
 */
const createIntegration = (store) => scraperManager.createAdapter(store);

module.exports = {
  createIntegration,
  scraperManager,
};
