const config = require('../config');
const { Product } = require('../models');
const { createTtlCache } = require('../utils/ttlCache');

// The sitemap is the same for every visitor and changes slowly — build it at most hourly
const cache = createTtlCache({ ttlMs: 60 * 60 * 1000, max: 2 });
const MAX_URLS = 45_000; // sitemaps.org limit is 50,000 per file

const STATIC_PATHS = [
  ['/', 'daily', '1.0'],
  ['/deals', 'hourly', '0.9'],
  ['/search', 'daily', '0.7'],
  ['/about', 'monthly', '0.3'],
  ['/privacy', 'yearly', '0.2'],
  ['/terms', 'yearly', '0.2'],
  ['/affiliate-disclosure', 'yearly', '0.2'],
];

const xmlEscape = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

const urlTag = (loc, { lastmod, changefreq, priority } = {}) =>
  `<url><loc>${xmlEscape(loc)}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}${
    changefreq ? `<changefreq>${changefreq}</changefreq>` : ''
  }${priority ? `<priority>${priority}</priority>` : ''}</url>`;

const buildSitemap = async () => {
  const site = config.siteUrl;
  const urls = STATIC_PATHS.map(([p, changefreq, priority]) => urlTag(`${site}${p}`, { changefreq, priority }));

  const [categories, brands] = await Promise.all([
    Product.distinct('category', { isActive: true, category: { $nin: [null, ''] } }),
    Product.distinct('brand', { isActive: true, brand: { $nin: [null, ''] } }),
  ]);
  for (const c of categories) urls.push(urlTag(`${site}/search?category=${encodeURIComponent(c)}`, { changefreq: 'daily', priority: '0.6' }));
  for (const b of brands) urls.push(urlTag(`${site}/brands/${encodeURIComponent(b)}`, { changefreq: 'daily', priority: '0.5' }));

  const products = await Product.find({ isActive: true }, { _id: 1, updatedAt: 1 })
    .sort({ updatedAt: -1 })
    .limit(Math.max(0, MAX_URLS - urls.length))
    .lean();
  for (const p of products) {
    urls.push(urlTag(`${site}/products/${p._id}`, { lastmod: p.updatedAt, changefreq: 'daily', priority: '0.8' }));
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>\n`;
};

const getSitemap = async (req, res, next) => {
  try {
    const xml = await cache.get('sitemap', buildSitemap);
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  } catch (err) {
    next(err);
  }
};

module.exports = { getSitemap };
