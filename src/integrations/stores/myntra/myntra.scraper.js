const config = require('../../../config');
const { getByExternalId, searchCatalog, buildDemoHtml } = require('../../demo/demoCatalog');
const { fetchHtml } = require('../base/httpClient');
const MyntraParser = require('./myntra.parser');

class MyntraScraper {
  constructor() {
    this.parser = new MyntraParser();
  }

  async fromDemo(externalProductId) {
    return getByExternalId('myntra', externalProductId);
  }

  async searchDemo(query, options = {}) {
    return searchCatalog('myntra', query, options.limit || 10);
  }

  async fromHtml(url) {
    if (config.scraper.mode === 'demo') {
      const match = url.match(/\/p\/([^/?#]+)/);
      const data = match?.[1] ? getByExternalId('myntra', match[1]) : null;
      if (!data) return null;
      const parsed = this.parser.parseProductPage(buildDemoHtml('myntra', data));
      return {
        ...data,
        ...parsed,
        currentPrice: parsed.currentPrice || data.currentPrice,
        externalProductId: data.externalProductId,
      };
    }

    const { html } = await fetchHtml(url);
    return { ...this.parser.parseProductPage(html), productUrl: url };
  }
}

module.exports = MyntraScraper;
