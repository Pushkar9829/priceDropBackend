/**
 * Shared types / constants for the store data-collection engine.
 */

const COLLECTION_METHODS = Object.freeze({
  OFFICIAL_API: 'OFFICIAL_API',
  AFFILIATE_API: 'AFFILIATE_API',
  MERCHANT_API: 'MERCHANT_API',
  PRODUCT_FEED: 'PRODUCT_FEED',
  DEMO_FEED: 'DEMO_FEED',
  HTTP_HTML: 'HTTP_HTML',
  PLAYWRIGHT: 'PLAYWRIGHT',
});

const FETCH_ERRORS = Object.freeze({
  TIMEOUT: 'TIMEOUT',
  NETWORK: 'NETWORK',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
  PRICE_MISSING: 'PRICE_MISSING',
  PARSE_FAILURE: 'PARSE_FAILURE',
  VALIDATION_FAILURE: 'VALIDATION_FAILURE',
  STORE_INACTIVE: 'STORE_INACTIVE',
  UNSUPPORTED: 'UNSUPPORTED',
});

/**
 * @typedef {Object} NormalizedStoreProduct
 * @property {string} externalProductId
 * @property {string} title
 * @property {string} [brand]
 * @property {string} [category]
 * @property {string} [subCategory]
 * @property {string} [modelNumber]
 * @property {number} currentPrice
 * @property {number|null} [mrp]
 * @property {number|null} [discount]
 * @property {string} currency
 * @property {string} availability
 * @property {string} [seller]
 * @property {string} productUrl
 * @property {string} [affiliateUrl]
 * @property {string[]} [images]
 * @property {number|null} [rating]
 * @property {number} [reviewCount]
 * @property {Object} [variant]
 * @property {Object} [attributes]
 * @property {Object} [identifiers]
 * @property {string} [collectionMethod]
 */

class CollectionError extends Error {
  constructor(message, code = FETCH_ERRORS.INVALID_RESPONSE, meta = {}) {
    super(message);
    this.name = 'CollectionError';
    this.code = code;
    this.meta = meta;
  }
}

module.exports = {
  COLLECTION_METHODS,
  FETCH_ERRORS,
  CollectionError,
};
