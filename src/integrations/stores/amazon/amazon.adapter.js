const StoreAdapter = require('../base/StoreAdapter');
const AmazonScraper = require('./amazon.scraper');
const { isLiveAmazonUrl, isFixtureUrl } = require('./amazon.scraper');
const AmazonParser = require('./amazon.parser');
const AmazonMapper = require('./amazon.mapper');
const creatorsApi = require('./amazon.creatorsApi');
const config = require('../../../config');
const { COLLECTION_METHODS, CollectionError, FETCH_ERRORS } = require('../base/store.types');

class AmazonAdapter extends StoreAdapter {
  constructor(store) {
    super(store);
    this.scraper = new AmazonScraper();
    this.parser = new AmazonParser();
    this.mapper = new AmazonMapper();
  }

  async fetchFromApiOrFeed(externalProductId) {
    if (!creatorsApi.isConfigured()) return null;

    const raw = await creatorsApi.getItem(externalProductId);
    if (!raw) return null;

    return {
      ...raw,
      collectionMethod: COLLECTION_METHODS.AFFILIATE_API,
    };
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
    if (existingUrl && isLiveAmazonUrl(existingUrl)) {
      return existingUrl;
    }

    if (creatorsApi.isConfigured() && externalProductId && !String(externalProductId).startsWith('AMZ-')) {
      const market = config.amazon.marketplace.replace(/^www\./, '');
      return `https://www.${market}/dp/${externalProductId}`;
    }

    if (existingUrl && isFixtureUrl(existingUrl)) {
      return existingUrl;
    }

    if (config.scraper.mode === 'http' || config.scraper.mode === 'auto') {
      if (externalProductId && /^[A-Z0-9]{10}$/i.test(externalProductId)) {
        const market = config.amazon.marketplace.replace(/^www\./, '');
        return `https://www.${market}/dp/${externalProductId}`;
      }
      return `${config.scraper.fixtureBase}/amazon/p/${externalProductId}`;
    }

    if (existingUrl) return existingUrl;
    return `https://demo.amazon.example/p/${externalProductId}`;
  }

  async fetchViaHttp(url) {
    if (isLiveAmazonUrl(url)) {
      throw new CollectionError(
        'Live Amazon pages require Playwright or Creators API',
        FETCH_ERRORS.NETWORK
      );
    }

    const raw = await this.scraper.fromHtml(url);
    if (!raw) {
      return super.fetchViaHttp(url);
    }
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

module.exports = AmazonAdapter;
