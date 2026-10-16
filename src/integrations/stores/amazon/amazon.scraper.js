const config = require('../../../config');
const { isStoreUrl } = require('../../../utils/storeUrl');
const { getByExternalId, searchCatalog, buildDemoHtml } = require('../../demo/demoCatalog');
const { fetchHtml } = require('../base/httpClient');
const { fetchRenderedHtml } = require('../base/browserClient');
const AmazonParser = require('./amazon.parser');

const isLiveAmazonUrl = (url = '') => isStoreUrl('amazon', url);

const isFixtureUrl = (url = '') => {
  try {
    return url.includes(config.scraper.fixtureBase) || /127\.0\.0\.1|localhost/i.test(url);
  } catch {
    return false;
  }
};

const marketplaceHost = () => {
  const market = (config.amazon.marketplace || 'www.amazon.in').replace(/^https?:\/\//, '');
  return market.startsWith('www.') ? market : `www.${market}`;
};

const buildSearchUrl = (query, page = 1) => {
  const q = encodeURIComponent(String(query).trim());
  const pageParam = page > 1 ? `&page=${page}` : '';
  // Match normal Amazon.in SERP URLs (ref helps avoid odd bot landing responses)
  return `https://${marketplaceHost()}/s?k=${q}${pageParam}&ref=nb_sb_noss_2`;
};

class AmazonScraper {
  constructor() {
    this.parser = new AmazonParser();
  }

  async fromDemo(externalProductId) {
    return getByExternalId('amazon', externalProductId);
  }

  async searchDemo(query, options = {}) {
    return searchCatalog('amazon', query, options.limit || 10);
  }

  async fromHtml(url) {
    if (config.scraper.mode === 'demo') {
      const match = url.match(/\/p\/([^/?#]+)/);
      const externalId = match?.[1];
      const data = externalId ? getByExternalId('amazon', externalId) : null;
      if (!data) return null;
      const html = buildDemoHtml('amazon', data);
      const parsed = this.parser.parseProductPage(html, url);
      return {
        ...data,
        ...parsed,
        currentPrice: parsed.currentPrice || data.currentPrice,
        externalProductId: data.externalProductId,
      };
    }

    const { html, url: finalUrl } = await fetchHtml(url);
    const parsed = this.parser.parseProductPage(html, finalUrl || url);
    return { ...parsed, productUrl: finalUrl || url };
  }

  async fromPlaywright(url) {
    const timeoutMs = Math.max(config.scraper.timeoutMs, 45_000);
    const { html, url: finalUrl } = await fetchRenderedHtml(url, {
      waitSelector:
        '#productTitle, #corePrice_feature_div .a-offscreen, .a-price .a-offscreen, h1',
      timeoutMs,
      delayMs: 1500,
      locale: 'en-IN',
    });
    const parsed = this.parser.parseProductPage(html, finalUrl || url);
    return { ...parsed, productUrl: finalUrl || url };
  }

  async searchLive(query, options = {}) {
    const limit = Math.max(1, Number(options.limit) || 10);
    const startPage = Math.max(1, Number(options.page) || 1);
    const maxPages = Math.max(
      1,
      Number(options.maxPages) || Math.min(120, Math.ceil(limit / 16) + 2)
    );
    const timeoutMs = Math.max(config.scraper.timeoutMs, 45_000);
    const base = `https://${marketplaceHost()}`;
    const seen = new Set();
    const results = [];
    const waitSelector =
      '[data-component-type="s-search-result"], .s-result-item[data-asin]';

    const { openBrowserSession } = require('../base/browserClient');
    const logger = require('../../../utils/logger');
    const session = await openBrowserSession({ timeoutMs, locale: 'en-IN' });

    try {
      for (let page = startPage; page < startPage + maxPages && results.length < limit; page++) {
        const url = buildSearchUrl(query, page);
        try {
          await session.goto(url, {
            waitSelector,
            delayMs: page === startPage ? 1200 : 800,
          });
          const { html } = await session.content();
          const batch = this.parser.parseSearchPage(html, base);
          if (!batch.length) {
            logger.warn('Amazon search page returned 0 cards', { page, url, kept: results.length });
            break;
          }

          let added = 0;
          for (const item of batch) {
            const key = item.externalProductId || item.productUrl;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            results.push(item);
            added += 1;
            if (results.length >= limit) break;
          }
          logger.info('Amazon search page OK', {
            page,
            batch: batch.length,
            added,
            total: results.length,
          });
          if (added === 0) break;
        } catch (pageErr) {
          // Keep earlier pages — do not fail the whole keyword scrape
          logger.warn('Amazon search page failed; returning partial results', {
            page,
            url,
            kept: results.length,
            error: pageErr.message,
          });
          break;
        }
      }
    } finally {
      await session.close().catch(() => {});
    }

    return results;
  }
}

module.exports = AmazonScraper;
module.exports.isLiveAmazonUrl = isLiveAmazonUrl;
module.exports.isFixtureUrl = isFixtureUrl;
module.exports.buildSearchUrl = buildSearchUrl;
