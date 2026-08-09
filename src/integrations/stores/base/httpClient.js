const axios = require('axios');
const config = require('../../../config');
const { CollectionError, FETCH_ERRORS } = require('./store.types');
const logger = require('../../../utils/logger');

/**
 * Shared Axios HTTP client for permitted HTML/API fetches.
 * No anti-bot evasion — polite User-Agent and timeouts only.
 */
const createHttpClient = (overrides = {}) =>
  axios.create({
    timeout: config.scraper.timeoutMs,
    maxRedirects: 5,
    headers: {
      'User-Agent': config.scraper.userAgent,
      Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-IN,en;q=0.9',
      ...overrides.headers,
    },
    validateStatus: (status) => status >= 200 && status < 400,
    ...overrides,
  });

const defaultClient = createHttpClient();

const fetchHtml = async (url, options = {}) => {
  try {
    const client = options.client || defaultClient;
    const response = await client.get(url, {
      responseType: 'text',
      ...options.axiosConfig,
    });
    return {
      html: typeof response.data === 'string' ? response.data : String(response.data),
      status: response.status,
      headers: response.headers,
      url: response.request?.res?.responseUrl || url,
    };
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      throw new CollectionError(`Timeout fetching ${url}`, FETCH_ERRORS.TIMEOUT);
    }
    if (err.response?.status === 404) {
      throw new CollectionError(`Product page not found: ${url}`, FETCH_ERRORS.PRODUCT_NOT_FOUND);
    }
    logger.warn('HTTP fetch failed', { url, error: err.message });
    throw new CollectionError(
      `Network error fetching ${url}: ${err.message}`,
      FETCH_ERRORS.NETWORK
    );
  }
};

const fetchJson = async (url, options = {}) => {
  try {
    const client = options.client || defaultClient;
    const response = await client.get(url, {
      responseType: 'json',
      ...options.axiosConfig,
    });
    return response.data;
  } catch (err) {
    if (err.code === 'ECONNABORTED') {
      throw new CollectionError(`Timeout fetching JSON ${url}`, FETCH_ERRORS.TIMEOUT);
    }
    throw new CollectionError(
      `Network error fetching JSON ${url}: ${err.message}`,
      FETCH_ERRORS.NETWORK
    );
  }
};

/**
 * Limited retries for transient network failures only.
 */
const withRetries = async (fn, { retries = config.scraper.maxRetries, label = 'request' } = {}) => {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const retryable =
        err.code === FETCH_ERRORS.TIMEOUT || err.code === FETCH_ERRORS.NETWORK;
      if (!retryable || attempt === retries) break;
      const delay = 300 * (attempt + 1);
      logger.debug('Retrying fetch', { label, attempt: attempt + 1, delay });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
};

module.exports = {
  createHttpClient,
  fetchHtml,
  fetchJson,
  withRetries,
};
