/**
 * Price / text normalization utilities shared by all store parsers.
 */

const parsePrice = (raw) => {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  }

  const cleaned = String(raw)
    .replace(/[₹$€£]/g, '')
    .replace(/INR|Rs\.?|rs\.?/gi, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .trim();

  if (!cleaned) return null;

  const match = cleaned.match(/(\d+(\.\d+)?)/);
  if (!match) return null;

  const value = parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
};

const normalizeCurrency = (raw) => {
  if (!raw) return 'INR';
  const v = String(raw).toUpperCase().trim();
  if (['INR', 'RS', 'RS.', '₹'].includes(v) || v.includes('INR')) return 'INR';
  if (['USD', '$'].includes(v)) return 'USD';
  return v.slice(0, 3);
};

const normalizeAvailability = (raw) => {
  if (!raw) return 'UNKNOWN';
  const v = String(raw).toUpperCase().trim();

  // Already-normalized enum values
  if (['IN_STOCK', 'OUT_OF_STOCK', 'PREORDER', 'UNKNOWN'].includes(v)) {
    return v;
  }

  // schema.org Offer availability URLs / tokens
  if (/OUTOFSTOCK|SOLD[_\s-]?OUT|DISCONTINUED/i.test(v)) return 'OUT_OF_STOCK';
  if (/INSTOCK|LIMITEDAVAILABILITY|ONLINEONLY|INSTOREONLY/i.test(v)) return 'IN_STOCK';
  if (/PREORDER|PRE[_\s-]?SALE/i.test(v)) return 'PREORDER';

  const lower = v.toLowerCase().replace(/[_-]+/g, ' ');
  if (/(out of stock|unavailable|sold out|currently unavailable)/.test(lower)) {
    return 'OUT_OF_STOCK';
  }
  if (/(in stock|available|add to cart|buy now)/.test(lower)) {
    return 'IN_STOCK';
  }
  if (/pre\s?order/.test(lower)) return 'PREORDER';
  return 'UNKNOWN';
};

const normalizeTitle = (title = '') =>
  String(title)
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s\-./+&()]/g, ' ')
    .trim();

const calcDiscount = (mrp, price) => {
  if (!mrp || !price || mrp <= 0) return 0;
  return Math.round(((mrp - price) / mrp) * 100);
};

/**
 * Convert store-specific raw fields into the common internal shape.
 */
const toNormalizedProduct = (raw = {}) => {
  const currentPrice = parsePrice(raw.currentPrice ?? raw.price);
  const mrp = parsePrice(raw.mrp);
  const currency = normalizeCurrency(raw.currency);
  const availability = normalizeAvailability(raw.availability);
  const title = normalizeTitle(raw.title || '');

  return {
    externalProductId: String(raw.externalProductId || raw.id || '').trim(),
    title,
    brand: raw.brand ? String(raw.brand).trim() : '',
    category: raw.category || 'General',
    subCategory: raw.subCategory || '',
    modelNumber: raw.modelNumber || raw.model || '',
    currentPrice,
    mrp,
    discount: raw.discount != null ? Number(raw.discount) : calcDiscount(mrp, currentPrice),
    currency,
    availability,
    seller: raw.seller || '',
    productUrl: raw.productUrl || '',
    affiliateUrl: raw.affiliateUrl || '',
    images: Array.isArray(raw.images) ? raw.images.filter(Boolean) : [],
    rating: raw.rating != null ? Number(raw.rating) : null,
    reviewCount: raw.reviewCount != null ? Number(raw.reviewCount) : 0,
    variant: raw.variant || raw.attributes || {},
    attributes: raw.attributes || raw.variant || {},
    identifiers: {
      modelNumber: raw.modelNumber || raw.model || '',
      asin: raw.asin || raw.identifiers?.asin || '',
      sku: raw.sku || raw.identifiers?.sku || '',
      gtin: raw.gtin || raw.identifiers?.gtin || '',
      mpn: raw.mpn || raw.identifiers?.mpn || '',
      isbn: raw.isbn || raw.identifiers?.isbn || '',
    },
    collectionMethod: raw.collectionMethod || null,
  };
};

module.exports = {
  parsePrice,
  normalizeCurrency,
  normalizeAvailability,
  normalizeTitle,
  calcDiscount,
  toNormalizedProduct,
};
