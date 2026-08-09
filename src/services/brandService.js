const { Brand, Product, StoreProduct } = require('../models');

const clampInt = (value, fallback, min, max) => {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Simple in-memory cache — Home hits this often. */
let cache = { key: '', at: 0, data: null };
const CACHE_TTL_MS = 5 * 60 * 1000;

const calcDiscount = (mrp, price) => {
  if (!(mrp > 0) || !(price > 0) || mrp <= price) return 0;
  return Math.round(((mrp - price) / mrp) * 100);
};

/**
 * Stats + sample products for one brand (indexed Product.brand).
 * Prefers listings whose title mentions the brand name for cleaner Top brands cards.
 */
const statsForBrand = async (brand, { minOff, perBrand }) => {
  const products = await Product.find({ brand: brand.name, isActive: true })
    .select('_id title images')
    .lean();

  if (!products.length) {
    return {
      name: brand.name,
      slug: brand.slug,
      category: brand.category,
      logo: null,
      dealCount: 0,
      maxDiscount: 0,
      products: [],
    };
  }

  const byId = new Map(products.map((p) => [String(p._id), p]));
  const ids = products.map((p) => p._id);

  const listings = await StoreProduct.find({
    productId: { $in: ids },
    isActive: true,
    mrp: { $gte: 1 },
    currentPrice: { $gte: 1 },
  })
    .select('productId title images currentPrice mrp discount')
    .lean();

  const brandRe = new RegExp(escapeRegex(brand.name.split(/\s+/)[0]), 'i');
  const deals = [];

  for (const sp of listings) {
    const pct =
      typeof sp.discount === 'number' && sp.discount > 0
        ? Math.round(sp.discount)
        : calcDiscount(sp.mrp, sp.currentPrice);
    if (pct < minOff) continue;

    const product = byId.get(String(sp.productId));
    const title = product?.title || sp.title || '';
    const images =
      (product?.images && product.images.length ? product.images : null) ||
      sp.images ||
      [];
    const titleMatch = brandRe.test(title);

    deals.push({
      id: String(sp.productId),
      title,
      images,
      currentPrice: sp.currentPrice,
      mrp: sp.mrp,
      discountPercent: pct,
      titleMatch,
    });
  }

  if (!deals.length) {
    return {
      name: brand.name,
      slug: brand.slug,
      category: brand.category,
      logo: null,
      dealCount: 0,
      maxDiscount: 0,
      products: [],
    };
  }

  // Prefer title-matched deals for the card; fall back to all discounted listings
  const preferred = deals.filter((d) => d.titleMatch);
  const pool = preferred.length >= perBrand ? preferred : deals;
  const dealCount = preferred.length > 0 ? preferred.length : deals.length;
  const maxDiscount = Math.max(...pool.map((d) => d.discountPercent));

  const seen = new Set();
  const samples = [];
  for (const d of [...pool].sort((a, b) => b.discountPercent - a.discountPercent)) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    samples.push({
      id: d.id,
      title: d.title,
      images: d.images,
      currentPrice: d.currentPrice,
      mrp: d.mrp,
      discountPercent: d.discountPercent,
    });
    if (samples.length >= perBrand) break;
  }

  return {
    name: brand.name,
    slug: brand.slug,
    category: brand.category,
    logo: null,
    dealCount,
    maxDiscount,
    products: samples,
  };
};

/**
 * Top brands for Home — ranked by live discounted listings (mrp vs price).
 */
const getTopBrands = async ({
  limit = 8,
  productsPerBrand = 3,
  minDiscount = 20,
  candidateLimit = 24,
} = {}) => {
  const topN = clampInt(limit, 8, 1, 24);
  const perBrand = clampInt(productsPerBrand, 3, 1, 6);
  const minOff = clampInt(minDiscount, 20, 1, 90);
  const candidates = clampInt(candidateLimit, 24, topN, 48);

  const cacheKey = `top:${topN}:${perBrand}:${minOff}:${candidates}`;
  if (cache.data && cache.key === cacheKey && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }

  const brandDocs = await Brand.find({
    isActive: true,
    savedCount: { $gt: 0 },
  })
    .sort({ savedCount: -1 })
    .limit(candidates)
    .select('name slug category savedCount')
    .lean();

  if (!brandDocs.length) {
    return { items: [] };
  }

  const scored = await Promise.all(
    brandDocs.map((b) => statsForBrand(b, { minOff, perBrand }))
  );

  const items = scored
    .filter((b) => b.dealCount > 0 && b.products.length > 0)
    .sort((a, b) => b.dealCount - a.dealCount || b.maxDiscount - a.maxDiscount)
    .slice(0, topN);

  const data = { items };
  cache = { key: cacheKey, at: Date.now(), data };
  return data;
};

/** Home category logo walls (matches Brand.category in catalog). */
const CATEGORY_SECTIONS = [
  { category: 'Electronics', title: 'Electronics & Tech', icon: 'electronics' },
  { category: 'Fashion', title: 'Fashion & Apparel', icon: 'fashion' },
  { category: 'Beauty', title: 'Beauty & Personal Care', icon: 'beauty' },
  { category: 'Home', title: 'Home & Living', icon: 'home' },
  { category: 'Food & Beverage', title: 'Food & Beverage', icon: 'food' },
  { category: 'Sports', title: 'Sports & Fitness', icon: 'sports' },
  { category: 'Automotive', title: 'Automotive', icon: 'auto' },
  { category: 'Toys', title: 'Toys & Games', icon: 'toys' },
  { category: 'Pets', title: 'Pets', icon: 'pets' },
];

let categoryCache = { key: '', at: 0, data: null };

/**
 * Lightweight per-brand deal count + max discount for logo grids.
 */
const lightBrandCard = async (brand) => {
  const productIds = await Product.find({ brand: brand.name, isActive: true })
    .select('_id')
    .limit(400)
    .lean();

  if (!productIds.length) {
    return {
      name: brand.name,
      slug: brand.slug,
      category: brand.category,
      logo: null,
      dealCount: brand.savedCount || 0,
      maxDiscount: 0,
    };
  }

  const ids = productIds.map((p) => p._id);
  const [agg] = await StoreProduct.aggregate([
    {
      $match: {
        productId: { $in: ids },
        isActive: true,
        mrp: { $gte: 1 },
        currentPrice: { $gte: 1 },
      },
    },
    {
      $addFields: {
        discountPercent: {
          $cond: [
            {
              $and: [
                { $gt: ['$mrp', 0] },
                { $gt: ['$currentPrice', 0] },
                { $gt: ['$mrp', '$currentPrice'] },
              ],
            },
            {
              $round: [
                {
                  $multiply: [
                    { $divide: [{ $subtract: ['$mrp', '$currentPrice'] }, '$mrp'] },
                    100,
                  ],
                },
              ],
            },
            { $ifNull: ['$discount', 0] },
          ],
        },
      },
    },
    { $match: { discountPercent: { $gte: 5 } } },
    {
      $group: {
        _id: null,
        dealCount: { $sum: 1 },
        maxDiscount: { $max: '$discountPercent' },
      },
    },
  ]);

  return {
    name: brand.name,
    slug: brand.slug,
    category: brand.category,
    logo: null,
    dealCount: agg?.dealCount || brand.savedCount || 0,
    maxDiscount: Math.round(agg?.maxDiscount || 0),
  };
};

/**
 * Brand logo sections by category for Home (Electronics, Fashion, …).
 */
const getCategorySections = async ({ brandsPerCategory = 12 } = {}) => {
  const perCat = clampInt(brandsPerCategory, 12, 4, 24);
  const cacheKey = `cats:${perCat}`;
  if (
    categoryCache.data &&
    categoryCache.key === cacheKey &&
    Date.now() - categoryCache.at < CACHE_TTL_MS
  ) {
    return categoryCache.data;
  }

  const sections = [];

  for (const def of CATEGORY_SECTIONS) {
    const brandDocs = await Brand.find({
      category: def.category,
      isActive: true,
      savedCount: { $gt: 0 },
    })
      .sort({ savedCount: -1 })
      .limit(perCat)
      .select('name slug category savedCount')
      .lean();

    if (!brandDocs.length) continue;

    const brands = await Promise.all(brandDocs.map((b) => lightBrandCard(b)));
    const withDeals = brands
      .filter((b) => b.dealCount > 0)
      .sort((a, b) => b.dealCount - a.dealCount || b.maxDiscount - a.maxDiscount);

    if (!withDeals.length) continue;

    sections.push({
      id: def.icon,
      category: def.category,
      title: def.title,
      icon: def.icon,
      count: withDeals.length,
      brands: withDeals,
    });
  }

  const data = { sections };
  categoryCache = { key: cacheKey, at: Date.now(), data };
  return data;
};

module.exports = { getTopBrands, getCategorySections, CATEGORY_SECTIONS };
