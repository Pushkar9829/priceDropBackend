const StoreAdapter = require('../base/StoreAdapter');
const CromaScraper = require('./croma.scraper');
const { isLiveCromaUrl, isFixtureUrl } = require('./croma.scraper');
const CromaParser = require('./croma.parser');
const CromaMapper = require('./croma.mapper');
const config = require('../../../config');
const { COLLECTION_METHODS, CollectionError, FETCH_ERRORS } = require('../base/store.types');

class CromaAdapter extends StoreAdapter {
  constructor(store) {
    super(store);
    this.scraper = new CromaScraper();
    this.parser = new CromaParser();
    this.mapper = new CromaMapper();
  }

  async fetchFromApiOrFeed() {
    if (!this.store.config?.affiliateApiKey) return null;
    return null;
  }

  async searchFromApiOrFeed(query, options) {
    if (!config.scraper.enablePlaywright) return null;
    if (config.scraper.mode !== 'http' && config.scraper.mode !== 'auto') return null;
    const results = await this.scraper.searchLive(query, options);
    return results.map((r) => ({
      ...r,
      collectionMethod: COLLECTION_METHODS.PLAYWRIGHT,
    }));
  }

  async fetchFromDemoFeed(externalProductId) {
    return this.scraper.fromDemo(externalProductId);
  }

  async searchFromDemoFeed(query, options) {
    return this.scraper.searchDemo(query, options);
  }

  buildProductUrl(externalProductId, existingUrl) {
    if (existingUrl && isLiveCromaUrl(existingUrl)) {
      return existingUrl;
    }

    if (existingUrl && isFixtureUrl(existingUrl)) {
      return existingUrl;
    }

    if (config.scraper.mode === 'http' || config.scraper.mode === 'auto') {
      return `${config.scraper.fixtureBase}/croma/p/${externalProductId}`;
    }

    return existingUrl || `https://demo.croma.example/p/${externalProductId}`;
  }

  async fetchViaHttp(url) {
    if (isLiveCromaUrl(url)) {
      throw new CollectionError(
        'Live Croma pages require Playwright (SCRAPER_ENABLE_PLAYWRIGHT=true)',
        FETCH_ERRORS.NETWORK
      );
    }

    const raw = await this.scraper.fromHtml(url);
    if (!raw) return super.fetchViaHttp(url);
    return this.mapRaw(raw, COLLECTION_METHODS.HTTP_HTML);
  }

  async fetchViaPlaywright(url) {
    if (!config.scraper.enablePlaywright) {
      throw new CollectionError('Playwright disabled', FETCH_ERRORS.UNSUPPORTED);
    }
    const raw = await this.scraper.fromPlaywright(url);
    return this.mapRaw(raw, COLLECTION_METHODS.PLAYWRIGHT);
  }
}

module.exports = CromaAdapter;
