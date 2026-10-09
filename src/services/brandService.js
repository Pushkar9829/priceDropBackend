const { Brand, Product } = require('../models');
const { createSlug } = require('../utils/helpers');

const clampInt = (value, fallback, min, max) => {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/** Small TTL cache — Home hits these on every visit; data only moves when prices change. */
const CACHE_TTL_MS = 2 * 60 * 1000;
const cache = new Map();
const cached = async (key, fn) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
};

/** Brand docs (slug/category) for display; brands without a doc still show up. */
const brandMeta = async (names) => {
  const docs = await Brand.find({ name: { $in: names } }).select('name slug category').lean();
  return new Map(docs.map((d) => [d.name, d]));
};

/**
 * Top brands for Home — ranked by how many products are currently discounted ≥ minDiscount,
 * read straight from Product.priceSummary (indexed), with sample deals per brand.
 */
const getTopBrands = ({ limit = 8, productsPerBrand = 3, minDiscount = 20 } = {}) => {
  const topN = clampInt(limit, 8, 1, 24);
  const perBrand = clampInt(productsPerBrand, 3, 1, 6);
  const minOff = clampInt(minDiscount, 20, 1, 90);

  return cached(`top:${topN}:${perBrand}:${minOff}`, async () => {
    const rows = await Product.aggregate([
      {
        $match: {
          isActive: true,
          brand: { $nin: [null, ''] },
          'priceSummary.discountPercent': { $gte: minOff },
          'priceSummary.lowestPrice': { $gt: 0 },
        },
      },
      { $sort: { 'priceSummary.discountPercent': -1 } },
      {
        $group: {
          _id: '$brand',
          dealCount: { $sum: 1 },
          maxDiscount: { $max: '$priceSummary.discountPercent' },
          // $firstN keeps only the top deals per brand (no unbounded array per group)
          products: {
            $firstN: {
              n: perBrand,
              input: {
                id: '$_id',
                title: '$title',
                images: { $slice: ['$images', 1] },
                currentPrice: '$priceSummary.lowestPrice',
                mrp: '$priceSummary.mrp',
                discountPercent: '$priceSummary.discountPercent',
              },
            },
          },
        },
      },
      { $sort: { dealCount: -1, maxDiscount: -1 } },
      { $limit: topN },
      { $project: { dealCount: 1, maxDiscount: 1, products: 1 } },
    ]);

    const meta = await brandMeta(rows.map((r) => r._id));
    return {
      items: rows.map((r) => ({
        name: r._id,
        slug: meta.get(r._id)?.slug || createSlug(r._id),
        category: meta.get(r._id)?.category || null,
        logo: null,
        dealCount: r.dealCount,
        maxDiscount: r.maxDiscount,
        products: r.products,
      })),
    };
  });
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

/**
 * Brand sections by category for Home — one aggregation over discounted products.
 * A brand's category comes from its Brand doc (catalog), falling back to the product category.
 */
const getCategorySections = ({ brandsPerCategory = 12 } = {}) => {
  const perCat = clampInt(brandsPerCategory, 12, 4, 24);

  return cached(`cats:${perCat}`, async () => {
    const rows = await Product.aggregate([
      {
        $match: {
          isActive: true,
          brand: { $nin: [null, ''] },
          'priceSummary.discountPercent': { $gte: 5 },
        },
      },
      {
        $group: {
          _id: '$brand',
          dealCount: { $sum: 1 },
          maxDiscount: { $max: '$priceSummary.discountPercent' },
          productCategory: { $first: '$category' },
        },
      },
    ]);

    const meta = await brandMeta(rows.map((r) => r._id));
    const byCategory = new Map(CATEGORY_SECTIONS.map((d) => [d.category, []]));
    for (const r of rows) {
      const category = meta.get(r._id)?.category || r.productCategory;
      if (!byCategory.has(category)) continue;
      byCategory.get(category).push({
        name: r._id,
        slug: meta.get(r._id)?.slug || createSlug(r._id),
        category,
        logo: null,
        dealCount: r.dealCount,
        maxDiscount: Math.round(r.maxDiscount || 0),
      });
    }

    const sections = CATEGORY_SECTIONS.map((def) => {
      const brands = byCategory
        .get(def.category)
        .sort((a, b) => b.dealCount - a.dealCount || b.maxDiscount - a.maxDiscount)
        .slice(0, perCat);
      return { id: def.icon, category: def.category, title: def.title, icon: def.icon, count: brands.length, brands };
    }).filter((s) => s.brands.length);

    // Brands that currently have at least one priced product (hero "N+ brands" line)
    const [{ n: totalBrands = 0 } = {}] = await Product.aggregate([
      { $match: { isActive: true, brand: { $nin: [null, ''] }, 'priceSummary.lowestPrice': { $gt: 0 } } },
      { $group: { _id: '$brand' } },
      { $count: 'n' },
    ]);
    return { sections, totalBrands };
  });
};

module.exports = { getTopBrands, getCategorySections, CATEGORY_SECTIONS };
