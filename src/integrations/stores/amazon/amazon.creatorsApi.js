/**
 * Amazon Creators API client (official affiliate catalog API).
 * Replaces deprecated PA-API 5.0. Requires Associates + Creators API credentials.
 *
 * Docs: https://affiliate-program.amazon.com/creatorsapi/
 */
const axios = require('axios');
const config = require('../../../config');
const logger = require('../../../utils/logger');
const { CollectionError, FETCH_ERRORS } = require('../base/store.types');

const CATALOG_BASE = 'https://creatorsapi.amazon/catalog/v1';

const TOKEN_ENDPOINTS = {
  '2.1': 'https://creatorsapi.auth.us-east-1.amazoncognito.com/oauth2/token',
  '2.2': 'https://creatorsapi.auth.eu-south-2.amazoncognito.com/oauth2/token',
  '2.3': 'https://creatorsapi.auth.us-west-2.amazoncognito.com/oauth2/token',
  '3.1': 'https://api.amazon.com/auth/o2/token',
  '3.2': 'https://api.amazon.co.uk/auth/o2/token',
  '3.3': 'https://api.amazon.co.jp/auth/o2/token',
};

const DEFAULT_RESOURCES = [
  'itemInfo.title',
  'itemInfo.byLineInfo',
  'itemInfo.productInfo',
  'itemInfo.classifications',
  'images.primary.large',
  'offersV2.listings.price',
  'offersV2.listings.availability',
  'offersV2.listings.merchantInfo',
  'detailPageURL',
];

let cachedToken = null;
let cachedTokenExpiresAt = 0;

const isConfigured = () => {
  const c = config.amazon;
  return Boolean(c.credentialId && c.credentialSecret && c.partnerTag);
};

const majorVersion = (version) => String(version || '2.2').split('.')[0];

const getTokenEndpoint = (version) => {
  const key = String(version || '2.2');
  const url = TOKEN_ENDPOINTS[key];
  if (!url) {
    throw new CollectionError(
      `Unsupported Amazon Creators API credential version: ${key}`,
      FETCH_ERRORS.UNSUPPORTED
    );
  }
  return url;
};

const fetchAccessToken = async () => {
  const { credentialId, credentialSecret, credentialVersion } = config.amazon;
  const version = String(credentialVersion || '2.2');
  const endpoint = getTokenEndpoint(version);
  const isV3 = majorVersion(version) === '3';

  let response;
  if (isV3) {
    response = await axios.post(
      endpoint,
      {
        grant_type: 'client_credentials',
        client_id: credentialId,
        client_secret: credentialSecret,
        scope: 'creatorsapi::default',
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: config.scraper.timeoutMs,
        validateStatus: () => true,
      }
    );
  } else {
    const basic = Buffer.from(`${credentialId}:${credentialSecret}`).toString('base64');
    response = await axios.post(
      endpoint,
      new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'creatorsapi/default',
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`,
        },
        timeout: config.scraper.timeoutMs,
        validateStatus: () => true,
      }
    );
  }

  if (response.status !== 200 || !response.data?.access_token) {
    logger.error('Amazon Creators API token failed', {
      status: response.status,
      body: response.data,
    });
    throw new CollectionError(
      'Amazon Creators API authentication failed',
      FETCH_ERRORS.NETWORK,
      { status: response.status, body: response.data }
    );
  }

  const expiresIn = Number(response.data.expires_in || 3600);
  cachedToken = response.data.access_token;
  // Refresh 60s early
  cachedTokenExpiresAt = Date.now() + Math.max(60, expiresIn - 60) * 1000;
  return cachedToken;
};

const getAccessToken = async () => {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) {
    return cachedToken;
  }
  return fetchAccessToken();
};

const authorizationHeader = (token) => {
  const version = String(config.amazon.credentialVersion || '2.2');
  if (majorVersion(version) === '3') {
    return `Bearer ${token}`;
  }
  return `Bearer ${token}, Version ${version}`;
};

const parseMoney = (listing) => {
  const money =
    listing?.price?.money ||
    listing?.price?.amount ||
    listing?.Price?.Money;
  if (money == null) return null;
  if (typeof money === 'number') return money;
  if (typeof money.amount === 'number') return money.amount;
  if (money.Amount != null) return Number(money.Amount);
  return null;
};

const mapItem = (item, marketplace) => {
  const asin = item.asin || item.ASIN;
  const title =
    item.itemInfo?.title?.displayValue ||
    item.ItemInfo?.Title?.DisplayValue ||
    '';
  const brand =
    item.itemInfo?.byLineInfo?.brand?.displayValue ||
    item.itemInfo?.byLineInfo?.manufacturer?.displayValue ||
    item.ItemInfo?.ByLineInfo?.Brand?.DisplayValue ||
    '';

  const listings =
    item.offersV2?.listings ||
    item.OffersV2?.Listings ||
    item.offers?.listings ||
    [];
  const listing = Array.isArray(listings) ? listings[0] : null;
  const currentPrice = parseMoney(listing);

  const availabilityRaw =
    listing?.availability?.message ||
    listing?.availability?.type ||
    listing?.Availability?.Message ||
    'UNKNOWN';

  const image =
    item.images?.primary?.large?.url ||
    item.Images?.Primary?.Large?.URL ||
    item.images?.primary?.medium?.url ||
    '';

  const detailUrl =
    item.detailPageURL ||
    item.DetailPageURL ||
    `https://${marketplace}/dp/${asin}`;

  const partnerTag = config.amazon.partnerTag;
  const affiliateUrl = partnerTag
    ? `${detailUrl}${detailUrl.includes('?') ? '&' : '?'}tag=${encodeURIComponent(partnerTag)}`
    : detailUrl;

  return {
    externalProductId: asin,
    asin,
    title,
    brand,
    currentPrice,
    mrp: null,
    currency: listing?.price?.money?.currency || 'INR',
    availability: availabilityRaw,
    seller: listing?.merchantInfo?.name || 'Amazon',
    productUrl: detailUrl,
    affiliateUrl,
    images: image ? [image] : [],
    collectionMethod: 'AFFILIATE_API',
  };
};

/**
 * @param {string|string[]} asins
 * @returns {Promise<Object[]>}
 */
const getItems = async (asins) => {
  if (!isConfigured()) {
    throw new CollectionError(
      'Amazon Creators API credentials not configured',
      FETCH_ERRORS.UNSUPPORTED
    );
  }

  const itemIds = (Array.isArray(asins) ? asins : [asins])
    .map((id) => String(id).trim())
    .filter(Boolean)
    .slice(0, 10);

  if (!itemIds.length) {
    throw new CollectionError('No ASINs provided', FETCH_ERRORS.PRODUCT_NOT_FOUND);
  }

  const marketplace = config.amazon.marketplace;
  const token = await getAccessToken();

  const response = await axios.post(
    `${CATALOG_BASE}/getItems`,
    {
      itemIds,
      itemIdType: 'ASIN',
      partnerTag: config.amazon.partnerTag,
      partnerType: 'Associates',
      marketplace,
      resources: DEFAULT_RESOURCES,
    },
    {
      headers: {
        Authorization: authorizationHeader(token),
        'Content-Type': 'application/json',
        'x-marketplace': marketplace,
      },
      timeout: config.scraper.timeoutMs,
      validateStatus: () => true,
    }
  );

  if (response.status !== 200) {
    logger.error('Amazon Creators API getItems failed', {
      status: response.status,
      body: response.data,
    });
    throw new CollectionError(
      `Amazon Creators API getItems HTTP ${response.status}`,
      FETCH_ERRORS.NETWORK,
      { status: response.status, body: response.data }
    );
  }

  const items =
    response.data?.itemsResult?.items ||
    response.data?.ItemsResult?.Items ||
    [];

  if (!items.length) {
    const errors = response.data?.errors || response.data?.Errors;
    throw new CollectionError(
      'Amazon product not found via Creators API',
      FETCH_ERRORS.PRODUCT_NOT_FOUND,
      { errors, itemIds }
    );
  }

  return items.map((item) => mapItem(item, marketplace));
};

const getItem = async (asin) => {
  const items = await getItems([asin]);
  return items[0] || null;
};

const clearTokenCache = () => {
  cachedToken = null;
  cachedTokenExpiresAt = 0;
};

module.exports = {
  isConfigured,
  getItems,
  getItem,
  clearTokenCache,
};
