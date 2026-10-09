const {
  normalizeTitle,
  extractStorage,
  extractRam,
} = require('../utils/helpers');
const config = require('../config');
const { Product, StoreProduct } = require('../models');
const logger = require('../utils/logger');

/**
 * Product matching with confidence scoring.
 * Does NOT auto-merge when confidence is below threshold.
 */
const scoreMatch = (candidate, incoming) => {
  let score = 0;
  const reasons = [];

  const cIds = candidate.identifiers || {};
  const iIds = incoming.identifiers || {};

  // 1. Exact product identifiers
  const idFields = ['asin', 'gtin', 'isbn', 'mpn', 'sku'];
  for (const field of idFields) {
    if (cIds[field] && iIds[field] && String(cIds[field]).toLowerCase() === String(iIds[field]).toLowerCase()) {
      score += 1.0;
      reasons.push(`exact_${field}`);
      return { score: 1.0, reasons, reject: false };
    }
  }

  // 2. Exact model number
  if (cIds.modelNumber && iIds.modelNumber) {
    if (String(cIds.modelNumber).toLowerCase() === String(iIds.modelNumber).toLowerCase()) {
      score += 0.5;
      reasons.push('exact_model');
    }
  }

  // 3. Brand + model
  const cBrand = (candidate.brand || '').toLowerCase();
  const iBrand = (incoming.brand || '').toLowerCase();
  if (cBrand && iBrand && cBrand === iBrand) {
    score += 0.2;
    reasons.push('brand_match');
  } else if (cBrand && iBrand && cBrand !== iBrand) {
    return { score: 0, reasons: ['brand_mismatch'], reject: true };
  }

  // 4. Normalized title similarity (simple token overlap)
  const cTitle = candidate.normalizedTitle || normalizeTitle(candidate.title);
  const iTitle = incoming.normalizedTitle || normalizeTitle(incoming.title);
  if (cTitle && iTitle) {
    const cTokens = new Set(cTitle.split(' ').filter(Boolean));
    const iTokens = new Set(iTitle.split(' ').filter(Boolean));
    const intersection = [...cTokens].filter((t) => iTokens.has(t)).length;
    const union = new Set([...cTokens, ...iTokens]).size;
    const jaccard = union === 0 ? 0 : intersection / union;
    score += jaccard * 0.35;
    reasons.push(`title_jaccard_${jaccard.toFixed(2)}`);
  }

  // 5. Variant attributes — reject mismatched critical variants
  const cAttrs = mapToObject(candidate.attributes);
  const iAttrs = mapToObject(incoming.attributes);

  const storageC = cAttrs.storage || extractStorage(candidate.title) || extractStorage(cTitle);
  const storageI = iAttrs.storage || extractStorage(incoming.title) || extractStorage(iTitle);

  if (storageC && storageI) {
    const sC = normalizeStorage(storageC);
    const sI = normalizeStorage(storageI);
    if (sC !== sI) {
      return { score: 0, reasons: ['storage_mismatch'], reject: true };
    }
    score += 0.15;
    reasons.push('storage_match');
  }

  const ramC = cAttrs.ram || extractRam(candidate.title);
  const ramI = iAttrs.ram || extractRam(incoming.title);
  if (ramC && ramI) {
    const rC = String(ramC).toLowerCase().replace(/\s/g, '');
    const rI = String(ramI).toLowerCase().replace(/\s/g, '');
    if (rC !== rI) {
      return { score: 0, reasons: ['ram_mismatch'], reject: true };
    }
    score += 0.1;
    reasons.push('ram_match');
  }

  // Color mismatch lowers confidence but does not hard-reject if other signals are strong
  if (cAttrs.color && iAttrs.color) {
    if (String(cAttrs.color).toLowerCase() === String(iAttrs.color).toLowerCase()) {
      score += 0.05;
      reasons.push('color_match');
    } else {
      score -= 0.1;
      reasons.push('color_mismatch');
    }
  }

  return { score: Math.min(1, Math.max(0, score)), reasons, reject: false };
};

const mapToObject = (attrs) => {
  if (!attrs) return {};
  if (attrs instanceof Map) return Object.fromEntries(attrs);
  return { ...attrs };
};

const normalizeStorage = (val) => {
  if (typeof val === 'number') return val;
  const str = String(val).toLowerCase().replace(/\s/g, '');
  const match = str.match(/(\d+)(tb|gb)?/);
  if (!match) return str;
  const n = parseInt(match[1], 10);
  if (match[2] === 'tb') return n * 1024;
  return n;
};

/**
 * Find best matching canonical product or null if confidence too low.
 */
const findBestMatch = async (incoming, { storeId } = {}) => {
  const filter = { isActive: true };
  if (incoming.brand) {
    filter.brand = new RegExp(`^${escapeRegex(incoming.brand)}$`, 'i');
  }

  // Rank candidates by text relevance so large brands don't hide the true match past the cap
  let candidates = null;
  if (incoming.title) {
    try {
      candidates = await Product.find(
        { ...filter, $text: { $search: incoming.title } },
        { score: { $meta: 'textScore' } }
      )
        .sort({ score: { $meta: 'textScore' } })
        .limit(50);
    } catch (err) {
      logger.debug('Matching text search unavailable', { error: err.message });
    }
  }
  if (!candidates || !candidates.length) {
    candidates = await Product.find(filter).sort({ updatedAt: -1 }).limit(50);
  }

  // A product may hold only one listing per store — skip products already taken by this store
  if (storeId && candidates.length) {
    const taken = await StoreProduct.find({
      storeId,
      productId: { $in: candidates.map((c) => c._id) },
    }).distinct('productId');
    const takenSet = new Set(taken.map(String));
    candidates = candidates.filter((c) => !takenSet.has(String(c._id)));
  }

  let best = null;

  for (const candidate of candidates) {
    const result = scoreMatch(candidate, incoming);
    if (result.reject) continue;
    if (!best || result.score > best.score) {
      best = { product: candidate, ...result };
    }
  }

  if (!best || best.score < config.matching.minConfidenceToMerge) {
    return { matched: false, confidence: best?.score || 0, product: null, reasons: best?.reasons || [] };
  }

  return {
    matched: true,
    confidence: best.score,
    product: best.product,
    reasons: best.reasons,
  };
};

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { scoreMatch, findBestMatch };
