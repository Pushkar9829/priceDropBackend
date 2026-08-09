const config = require('../../../config');
const { getByExternalId, searchCatalog, buildDemoHtml } = require('../../demo/demoCatalog');
const { fetchHtml } = require('../base/httpClient');
const { fetchRenderedHtml } = require('../base/browserClient');
const FlipkartParser = require('./flipkart.parser');

const isLiveFlipkartUrl = (url = '') =>
  /^https?:\/\/([^/]+\.)?flipkart\.com\b/i.test(url);

const isFixtureUrl = (url = '') => {
  try {
    return url.includes(config.scraper.fixtureBase) || /127\.0\.0\.1|localhost/i.test(url);
  } catch {
    return false;
  }
};

const buildSearchUrl = (query, page = 1) => {
  const q = encodeURIComponent(String(query).trim());
  const pageParam = page > 1 ? `&page=${page}` : '';
  return `https://www.flipkart.com/search?q=${q}${pageParam}`;
};

class FlipkartScraper {
  constructor() {
    this.parser = new FlipkartParser();
  }

  async fromDemo(externalProductId) {
    return getByExternalId('flipkart', externalProductId);
  }

  async searchDemo(query, options = {}) {
    return searchCatalog('flipkart', query, options.limit || 10);
  }

  /**
   * HTTP + Cheerio — suitable for local fixture pages.
   * Live flipkart.com usually needs Playwright (JS / bot checks).
   */
  async fromHtml(url) {
    if (config.scraper.mode === 'demo') {
      const match = url.match(/\/p\/([^/?#]+)/);
      const data = match?.[1] ? getByExternalId('flipkart', match[1]) : null;
      if (!data) return null;
      const parsed = this.parser.parseProductPage(buildDemoHtml('flipkart', data), url);
      return {
        ...data,
        ...parsed,
        currentPrice: parsed.currentPrice || data.currentPrice,
        externalProductId: data.externalProductId,
      };
    }

    const { html, url: finalUrl } = await fetchHtml(url);
    return { ...this.parser.parseProductPage(html, finalUrl || url), productUrl: finalUrl || url };
  }

  /**
   * Live / rendered Flipkart PDP via Playwright.
   */
  async fromPlaywright(url) {
    const timeoutMs = Math.max(config.scraper.timeoutMs, 45_000);
    const { html, url: finalUrl } = await fetchRenderedHtml(url, {
      waitSelector:
        'span.VU-ZEz, span.B_NuCI, h1, div.Nx9bqj, div.oFEPlD, script[type="application/ld+json"]',
      timeoutMs,
      delayMs: 1200,
      locale: 'en-IN',
    });
    const parsed = this.parser.parseProductPage(html, finalUrl || url);
    return { ...parsed, productUrl: finalUrl || url };
  }

  /**
   * Live Flipkart search via Playwright — walks `?page=` until limit or no new cards.
   */
  async searchLive(query, options = {}) {
    const limit = Math.max(1, Number(options.limit) || 10);
    const startPage = Math.max(1, Number(options.page) || 1);
    const maxPages = Math.max(
      1,
      Number(options.maxPages) || Math.min(120, Math.ceil(limit / 12) + 2)
    );
    const timeoutMs = Math.max(config.scraper.timeoutMs, 45_000);
    const seen = new Set();
    const results = [];

    for (let page = startPage; page < startPage + maxPages && results.length < limit; page++) {
      const url = buildSearchUrl(query, page);
      const { html } = await fetchRenderedHtml(url, {
        waitSelector: 'div[data-id], a[href*="/p/"]',
        timeoutMs,
        delayMs: page === startPage ? 1200 : 800,
        locale: 'en-IN',
      });

      const batch = this.parser.parseSearchPage(html);
      if (!batch.length) break;

      let added = 0;
      for (const item of batch) {
        const key = item.externalProductId || item.productUrl;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        results.push(item);
        added += 1;
        if (results.length >= limit) break;
      }

      // No new unique cards → last page reached
      if (added === 0) break;
    }

    return results;
  }
}

module.exports = FlipkartScraper;
module.exports.isLiveFlipkartUrl = isLiveFlipkartUrl;
module.exports.isFixtureUrl = isFixtureUrl;
module.exports.buildSearchUrl = buildSearchUrl;
