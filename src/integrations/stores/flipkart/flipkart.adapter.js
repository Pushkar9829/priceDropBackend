const StoreAdapter = require('../base/StoreAdapter');
const FlipkartScraper = require('./flipkart.scraper');
const { isLiveFlipkartUrl, isFixtureUrl } = require('./flipkart.scraper');
const FlipkartParser = require('./flipkart.parser');
const FlipkartMapper = require('./flipkart.mapper');
const config = require('../../../config');
const { COLLECTION_METHODS, CollectionError, FETCH_ERRORS } = require('../base/store.types');

/**
 * Flipkart adapter — no affiliate API.
 * Live flipkart.com PDPs use Playwright; local fixtures use Axios + Cheerio.
 */
class FlipkartAdapter extends StoreAdapter {
  constructor(store) {
    super(store);
    this.scraper = new FlipkartScraper();
    this.parser = new FlipkartParser();
    this.mapper = new FlipkartMapper();
  }

  async fetchFromApiOrFeed() {
    // No affiliate / official catalog API configured for Flipkart.
    return null;
  }

  /**
   * Live search when Playwright is enabled (http/auto). Otherwise null → demo/empty.
   */
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
    // Prefer a real Flipkart PDP URL stored on the listing
    if (existingUrl && isLiveFlipkartUrl(existingUrl)) {
      return existingUrl;
    }

    // Keep fixture URLs for local scrape:test / fixture server
    if (existingUrl && isFixtureUrl(existingUrl)) {
      return existingUrl;
    }

    if (config.scraper.mode === 'http' || config.scraper.mode === 'auto') {
      // Without a live URL, fall back to fixture (seeded demo IDs are not Flipkart PIDs)
      return `${config.scraper.fixtureBase}/flipkart/p/${externalProductId}`;
    }

    return existingUrl || `https://demo.flipkart.example/p/${externalProductId}`;
  }

  async fetchViaHttp(url) {
    // Live Flipkart pages are JS-heavy / often block plain Axios — force Playwright path
    if (isLiveFlipkartUrl(url)) {
      throw new CollectionError(
        'Live Flipkart PDPs require Playwright (SCRAPER_ENABLE_PLAYWRIGHT=true)',
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

module.exports = FlipkartAdapter;
