const StoreAdapter = require('../base/StoreAdapter');
const MyntraScraper = require('./myntra.scraper');
const MyntraParser = require('./myntra.parser');
const MyntraMapper = require('./myntra.mapper');

class MyntraAdapter extends StoreAdapter {
  constructor(store) {
    super(store);
    this.scraper = new MyntraScraper();
    this.parser = new MyntraParser();
    this.mapper = new MyntraMapper();
  }

  async fetchFromApiOrFeed() {
    if (!this.store.config?.affiliateApiKey) return null;
    return null;
  }

  async fetchFromDemoFeed(externalProductId) {
    return this.scraper.fromDemo(externalProductId);
  }

  async searchFromDemoFeed(query, options) {
    return this.scraper.searchDemo(query, options);
  }

  buildProductUrl(externalProductId, existingUrl) {
    const config = require('../../../config');
    if (config.scraper.mode === 'http' || config.scraper.mode === 'auto') {
      return `${config.scraper.fixtureBase}/myntra/p/${externalProductId}`;
    }
    return existingUrl || `https://demo.myntra.example/p/${externalProductId}`;
  }

  async fetchViaHttp(url) {
    const raw = await this.scraper.fromHtml(url);
    if (!raw) return super.fetchViaHttp(url);
    return this.mapRaw(raw, 'HTTP_HTML');
  }
}

module.exports = MyntraAdapter;
