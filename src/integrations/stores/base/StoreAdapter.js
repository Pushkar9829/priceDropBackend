const config = require('../../../config');
const logger = require('../../../utils/logger');
const {
  COLLECTION_METHODS,
  CollectionError,
  FETCH_ERRORS,
} = require('./store.types');
const { toNormalizedProduct } = require('./normalizer');
const { validateNormalizedProduct } = require('./validator');
const { fetchHtml, withRetries } = require('./httpClient');
const { fetchRenderedHtml } = require('./browserClient');

/**
 * Base Store Adapter
 *
 * Preferred collection order:
 * 1. Official / affiliate / merchant API / authorized feed
 * 2. Demo feed (local/dev)
 * 3. Direct HTTP + Cheerio (permitted sources only)
 * 4. Playwright (only when enabled and necessary)
 *
 * Does NOT implement anti-bot bypassing.
 */
class StoreAdapter {
  constructor(store) {
    this.store = store;
    this.slug = store.slug;
    this.parser = null;
    this.mapper = null;
  }

  /**
   * Override in subclasses when a real API/feed is configured.
   */
  async fetchFromApiOrFeed(_externalProductId) {
    return null;
  }

  async searchFromApiOrFeed(_query, _options) {
    return null;
  }

  /**
   * Demo catalog fallback — used when SCRAPER_MODE=demo or no credentials.
   */
  async fetchFromDemoFeed(_externalProductId) {
    return null;
  }

  async searchFromDemoFeed(_query, _options) {
    return null;
  }

  /**
   * Build product page URL for HTTP/Playwright fetch.
   */
  buildProductUrl(externalProductId, existingUrl) {
    return existingUrl || null;
  }

  /**
   * Parse HTML via store-specific Cheerio parser.
   */
  parseHtml(html) {
    if (!this.parser) {
      throw new CollectionError('No parser configured', FETCH_ERRORS.PARSE_FAILURE);
    }
    return this.parser.parseProductPage(html);
  }

  mapRaw(raw, collectionMethod) {
    const mapped = this.mapper ? this.mapper.map(raw) : raw;
    return toNormalizedProduct({ ...mapped, collectionMethod });
  }

  async fetchViaHttp(url) {
    const { html } = await withRetries(() => fetchHtml(url), {
      label: `${this.slug}:http`,
    });
    const raw = this.parseHtml(html);
    return this.mapRaw(raw, COLLECTION_METHODS.HTTP_HTML);
  }

  async fetchViaPlaywright(url) {
    if (!config.scraper.enablePlaywright) {
      throw new CollectionError('Playwright disabled', FETCH_ERRORS.UNSUPPORTED);
    }
    const { html } = await fetchRenderedHtml(url);
    const raw = this.parseHtml(html);
    return this.mapRaw(raw, COLLECTION_METHODS.PLAYWRIGHT);
  }

  /**
   * Resolve collection strategy for a single product.
   */
  async getProductDetails(externalProductId, { productUrl } = {}) {
    logger.debug('Product fetch started', {
      store: this.slug,
      externalProductId,
    });

    const mode = config.scraper.mode;
    let result = null;

    // 1. Official API / feed if available
    result = await this.fetchFromApiOrFeed(externalProductId);
    if (result) {
      const normalized = this.mapRaw(result, result.collectionMethod || COLLECTION_METHODS.PRODUCT_FEED);
      validateNormalizedProduct(normalized);
      logger.debug('Product fetch completed', {
        store: this.slug,
        method: normalized.collectionMethod,
      });
      return normalized;
    }

    // 2. Demo feed (default safe mode)
    if (mode === 'demo' || mode === 'auto') {
      result = await this.fetchFromDemoFeed(externalProductId);
      if (result) {
        const normalized = this.mapRaw(result, COLLECTION_METHODS.DEMO_FEED);
        validateNormalizedProduct(normalized);
        logger.debug('Product fetch completed', {
          store: this.slug,
          method: COLLECTION_METHODS.DEMO_FEED,
        });
        return normalized;
      }
    }

    // 3. HTTP + Cheerio (only in http/auto modes against a known URL)
    const url = this.buildProductUrl(externalProductId, productUrl);
    if ((mode === 'http' || mode === 'auto') && url) {
      try {
        let normalized = await this.fetchViaHttp(url);
        normalized = {
          ...normalized,
          externalProductId: normalized.externalProductId || externalProductId,
          productUrl: normalized.productUrl || url,
        };
        validateNormalizedProduct(normalized, { requireUrl: true });
        logger.debug('Product fetch completed', {
          store: this.slug,
          method: COLLECTION_METHODS.HTTP_HTML,
        });
        return normalized;
      } catch (err) {
        logger.warn('HTTP collection failed', {
          store: this.slug,
          error: err.message,
        });

        // 4. Playwright fallback
        if (config.scraper.enablePlaywright) {
          let normalized = await this.fetchViaPlaywright(url);
          normalized = {
            ...normalized,
            externalProductId: normalized.externalProductId || externalProductId,
            productUrl: normalized.productUrl || url,
          };
          validateNormalizedProduct(normalized, { requireUrl: true });
          logger.debug('Product fetch completed', {
            store: this.slug,
            method: COLLECTION_METHODS.PLAYWRIGHT,
          });
          return normalized;
        }

        throw err;
      }
    }

    throw new CollectionError(
      `Unable to collect product ${externalProductId} from ${this.slug}`,
      FETCH_ERRORS.PRODUCT_NOT_FOUND
    );
  }

  async getCurrentPrice(externalProductId, options = {}) {
    const details = await this.getProductDetails(externalProductId, options);
    return {
      price: details.currentPrice,
      currency: details.currency,
      availability: details.availability,
      mrp: details.mrp,
      collectionMethod: details.collectionMethod,
      raw: details,
    };
  }

  async getAvailability(externalProductId, options = {}) {
    const details = await this.getProductDetails(externalProductId, options);
    return details.availability;
  }

  async searchProducts(query, options = {}) {
    const mode = config.scraper.mode;

    let results = await this.searchFromApiOrFeed(query, options);
    if (!results && (mode === 'demo' || mode === 'auto')) {
      results = await this.searchFromDemoFeed(query, options);
    }

    if (!results) return [];

    return results.map((raw) => {
      const normalized = this.mapRaw(
        raw,
        raw.collectionMethod || COLLECTION_METHODS.DEMO_FEED
      );
      try {
        validateNormalizedProduct(normalized);
        return normalized;
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  async getProductByExternalId(externalProductId, options = {}) {
    return this.getProductDetails(externalProductId, options);
  }
}

module.exports = StoreAdapter;
