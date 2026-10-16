const config = require('../../../config');
const { isStoreUrl } = require('../../../utils/storeUrl');
const { getByExternalId, searchCatalog, buildDemoHtml } = require('../../demo/demoCatalog');
const { fetchHtml } = require('../base/httpClient');
const { fetchRenderedHtml } = require('../base/browserClient');
const CromaParser = require('./croma.parser');

const isLiveCromaUrl = (url = '') => isStoreUrl('croma', url);

const isFixtureUrl = (url = '') => {
  try {
    return url.includes(config.scraper.fixtureBase) || /127\.0\.0\.1|localhost/i.test(url);
  } catch {
    return false;
  }
};

const buildSearchUrl = (query) => {
  const q = encodeURIComponent(String(query).trim());
  return `https://www.croma.com/searchB?q=${q}`;
};

class CromaScraper {
  constructor() {
    this.parser = new CromaParser();
  }

  async fromDemo(externalProductId) {
    return getByExternalId('croma', externalProductId);
  }

  async searchDemo(query, options = {}) {
    return searchCatalog('croma', query, options.limit || 10);
  }

  async fromHtml(url) {
    if (config.scraper.mode === 'demo') {
      const match = url.match(/\/p\/([^/?#]+)/);
      const data = match?.[1] ? getByExternalId('croma', match[1]) : null;
      if (!data) return null;
      const parsed = this.parser.parseProductPage(buildDemoHtml('croma', data), url);
      return {
        ...data,
        ...parsed,
        currentPrice: parsed.currentPrice || data.currentPrice,
        externalProductId: data.externalProductId,
      };
    }

    const { html, url: finalUrl } = await fetchHtml(url);
    return {
      ...this.parser.parseProductPage(html, finalUrl || url),
      productUrl: finalUrl || url,
    };
  }

  async fromPlaywright(url) {
    const timeoutMs = Math.max(config.scraper.timeoutMs, 45_000);
    const { html, url: finalUrl } = await fetchRenderedHtml(url, {
      waitSelector: 'h1, .pdp-title, .new-price, [class*="Price"]',
      timeoutMs,
      delayMs: 1500,
      locale: 'en-IN',
    });
    const parsed = this.parser.parseProductPage(html, finalUrl || url);
    return { ...parsed, productUrl: finalUrl || url };
  }

  async searchLive(query, options = {}) {
    const limit = options.limit || 10;
    const url = buildSearchUrl(query);
    const timeoutMs = Math.max(config.scraper.timeoutMs, 45_000);

    const { html } = await fetchRenderedHtml(url, {
      waitSelector: 'a[href*="/p/"], [class*="product"]',
      timeoutMs,
      delayMs: 2000,
      locale: 'en-IN',
    });

    return this.parser.parseSearchPage(html).slice(0, limit);
  }
}

module.exports = CromaScraper;
module.exports.isLiveCromaUrl = isLiveCromaUrl;
module.exports.isFixtureUrl = isFixtureUrl;
module.exports.buildSearchUrl = buildSearchUrl;
