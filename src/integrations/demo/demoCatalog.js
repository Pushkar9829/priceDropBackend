/**
 * Demo authorized product feed — used when SCRAPER_MODE=demo (default).
 * Simulates merchant/affiliate feed data. Does not scrape live retailer sites.
 * Prices drift slightly to exercise automated monitoring.
 *
 * Images: Unsplash CDN (stable photo IDs) — suitable for local UI demos.
 */
const catalog = [
  {
    key: 'iphone-16-128',
    brand: 'Apple',
    title: 'Apple iPhone 16 128GB Black',
    category: 'Electronics',
    subCategory: 'Mobiles',
    modelNumber: 'iPhone 16',
    attributes: { storage: '128GB', color: 'Black', ram: null },
    mrp: 79900,
    description:
      'iPhone 16 with the A18 chip, advanced dual-camera system, and a durable design in Black. 128GB storage.',
    images: [
      'https://images.unsplash.com/photo-1695048133142-1a20484428d3?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=800&q=80',
    ],
    stores: {
      amazon: { externalId: 'AMZ-IP16-128', title: 'Apple iPhone 16 128GB Black', basePrice: 70000, seller: 'Amazon', rating: 4.6, reviewCount: 12480 },
      flipkart: { externalId: 'FK-IP16-128', title: 'Apple iPhone 16 128 GB Black', basePrice: 68999, seller: 'RetailNet', rating: 4.5, reviewCount: 9820 },
      croma: { externalId: 'CR-IP16-128', title: 'Apple iPhone 16 (128GB, Black)', basePrice: 71500, seller: 'Croma', rating: 4.4, reviewCount: 2104 },
      myntra: null,
    },
  },
  {
    key: 'iphone-16-256',
    brand: 'Apple',
    title: 'Apple iPhone 16 256GB Black',
    category: 'Electronics',
    subCategory: 'Mobiles',
    modelNumber: 'iPhone 16',
    attributes: { storage: '256GB', color: 'Black', ram: null },
    mrp: 89900,
    description:
      'iPhone 16 256GB — more storage for photos, video, and apps. Same A18 performance in Black.',
    images: [
      'https://images.unsplash.com/photo-1591337676887-a217a6970a8a?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1695048133142-1a20484428d3?auto=format&fit=crop&w=800&q=80',
    ],
    stores: {
      amazon: { externalId: 'AMZ-IP16-256', title: 'Apple iPhone 16 256GB Black', basePrice: 79900, seller: 'Amazon', rating: 4.7, reviewCount: 6420 },
      flipkart: { externalId: 'FK-IP16-256', title: 'Apple iPhone 16 256 GB Black', basePrice: 78999, seller: 'RetailNet', rating: 4.6, reviewCount: 5110 },
      croma: { externalId: 'CR-IP16-256', title: 'Apple iPhone 16 (256GB, Black)', basePrice: 80900, seller: 'Croma', rating: 4.5, reviewCount: 980 },
      myntra: null,
    },
  },
  {
    key: 'galaxy-s24-128',
    brand: 'Samsung',
    title: 'Samsung Galaxy S24 8GB 128GB',
    category: 'Electronics',
    subCategory: 'Mobiles',
    modelNumber: 'Galaxy S24',
    attributes: { storage: '128GB', color: 'Onyx Black', ram: '8GB' },
    mrp: 74999,
    description:
      'Galaxy S24 with 8GB RAM and 128GB storage. Flagship camera, bright display, and Galaxy AI features.',
    images: [
      'https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1585060544812-6b45742d762f?auto=format&fit=crop&w=800&q=80',
    ],
    stores: {
      amazon: { externalId: 'AMZ-S24-128', title: 'Samsung Galaxy S24 8GB RAM 128GB', basePrice: 64999, seller: 'Amazon', rating: 4.4, reviewCount: 8750 },
      flipkart: { externalId: 'FK-S24-128', title: 'Samsung Galaxy S24 8 GB 128 GB', basePrice: 63999, seller: 'RetailNet', rating: 4.5, reviewCount: 11200 },
      croma: { externalId: 'CR-S24-128', title: 'Samsung Galaxy S24 (8GB/128GB)', basePrice: 66999, seller: 'Croma', rating: 4.3, reviewCount: 1540 },
      myntra: null,
    },
  },
  {
    key: 'nike-air-force',
    brand: 'Nike',
    title: 'Nike Air Force 1 Low White',
    category: 'Fashion',
    subCategory: 'Footwear',
    modelNumber: 'AF1-LOW',
    attributes: { size: 'UK 9', color: 'White' },
    mrp: 9695,
    description:
      'Classic Nike Air Force 1 Low in White — leather upper, Air cushioning, UK 9.',
    images: [
      'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1600269452121-4f2416e55c28?auto=format&fit=crop&w=800&q=80',
    ],
    stores: {
      amazon: { externalId: 'AMZ-AF1-W', title: 'Nike Air Force 1 Low White UK 9', basePrice: 7495, seller: 'Amazon', rating: 4.3, reviewCount: 3200 },
      flipkart: null,
      croma: null,
      myntra: { externalId: 'MY-AF1-W', title: 'Nike Air Force 1 Low Sneakers White', basePrice: 7299, seller: 'Nike', rating: 4.5, reviewCount: 8900 },
    },
  },
  {
    key: 'macbook-air-m3',
    brand: 'Apple',
    title: 'Apple MacBook Air M3 8GB 256GB',
    category: 'Electronics',
    subCategory: 'Laptops',
    modelNumber: 'MacBook Air M3',
    attributes: { storage: '256GB', ram: '8GB', color: 'Midnight' },
    mrp: 114900,
    description:
      'MacBook Air with M3 chip, 8GB unified memory, 256GB SSD, Midnight finish — thin, quiet, all-day battery.',
    images: [
      'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1611186871348-b1ce696e52c9?auto=format&fit=crop&w=800&q=80',
    ],
    stores: {
      amazon: { externalId: 'AMZ-MBA-M3', title: 'Apple MacBook Air M3 8GB 256GB Midnight', basePrice: 99900, seller: 'Amazon', rating: 4.7, reviewCount: 4580 },
      flipkart: { externalId: 'FK-MBA-M3', title: 'Apple MacBook Air M3 8 GB 256 GB', basePrice: 98990, seller: 'RetailNet', rating: 4.6, reviewCount: 3120 },
      croma: { externalId: 'CR-MBA-M3', title: 'Apple MacBook Air (M3, 8GB, 256GB)', basePrice: 101990, seller: 'Croma', rating: 4.5, reviewCount: 860 },
      myntra: null,
    },
  },
];

const STORE_LOGOS = {
  amazon: 'https://logo.clearbit.com/amazon.in',
  flipkart: 'https://logo.clearbit.com/flipkart.com',
  myntra: 'https://logo.clearbit.com/myntra.com',
  croma: 'https://logo.clearbit.com/croma.com',
};

const priceState = new Map();

const jitterPrice = (externalId, basePrice) => {
  if (!priceState.has(externalId)) {
    priceState.set(externalId, basePrice);
    return basePrice;
  }

  const current = priceState.get(externalId);
  if (Math.random() > 0.35) return current;

  const deltaPercent = (Math.random() * 8 - 4) / 100;
  const next = Math.max(100, Math.round(current * (1 + deltaPercent)));
  priceState.set(externalId, next);
  return next;
};

const findByExternalId = (storeSlug, externalId) => {
  for (const item of catalog) {
    const storeEntry = item.stores[storeSlug];
    if (storeEntry && storeEntry.externalId === externalId) {
      return { item, storeEntry };
    }
  }
  return null;
};

const toFeedItem = (storeSlug, item, storeEntry) => {
  const price = jitterPrice(storeEntry.externalId, storeEntry.basePrice);
  return {
    externalProductId: storeEntry.externalId,
    title: storeEntry.title,
    brand: item.brand,
    category: item.category,
    subCategory: item.subCategory,
    modelNumber: item.modelNumber,
    attributes: item.attributes,
    currentPrice: price,
    mrp: item.mrp,
    currency: 'INR',
    availability: 'IN_STOCK',
    productUrl: `https://demo.${storeSlug}.example/p/${storeEntry.externalId}`,
    affiliateUrl: `https://demo.${storeSlug}.example/aff/${storeEntry.externalId}`,
    seller: storeEntry.seller,
    images: item.images,
    rating: storeEntry.rating ?? 4.2 + Math.random() * 0.6,
    reviewCount: storeEntry.reviewCount ?? Math.floor(500 + Math.random() * 5000),
    variant: item.attributes,
  };
};

const searchCatalog = (storeSlug, query, limit = 10) => {
  const q = (query || '').toLowerCase();
  const results = [];

  for (const item of catalog) {
    const storeEntry = item.stores[storeSlug];
    if (!storeEntry) continue;

    const haystack = `${item.title} ${item.brand} ${item.modelNumber}`.toLowerCase();
    if (!q || haystack.includes(q) || q.split(/\s+/).every((t) => haystack.includes(t))) {
      results.push(toFeedItem(storeSlug, item, storeEntry));
    }
    if (results.length >= limit) break;
  }

  return results;
};

const getByExternalId = (storeSlug, externalId) => {
  const found = findByExternalId(storeSlug, externalId);
  if (!found) return null;
  return toFeedItem(storeSlug, found.item, found.storeEntry);
};

/**
 * Build a minimal HTML fixture so Cheerio parsers can be unit-exercised
 * without hitting live retailer sites.
 */
const buildDemoHtml = (storeSlug, data) => `
<!DOCTYPE html>
<html>
<head><title>${data.title}</title></head>
<body>
  <h1 id="productTitle" class="product-title B_NuCI">${data.title}</h1>
  <span class="a-price-whole pdp-price">${data.currentPrice}</span>
  <span class="a-offscreen">₹${data.currentPrice}</span>
  <div class="price">₹${data.currentPrice}</div>
  <div id="priceblock_ourprice">₹${data.currentPrice}</div>
  <div class="Nx9bqj">${data.currentPrice}</div>
  <div class="new-price">${data.currentPrice}</div>
  <span id="availability" class="availability">In Stock</span>
  <div data-brand="${data.brand || ''}"></div>
  <img id="landingImage" src="${(data.images && data.images[0]) || ''}" />
</body>
</html>
`;

module.exports = {
  catalog,
  STORE_LOGOS,
  searchCatalog,
  getByExternalId,
  findByExternalId,
  jitterPrice,
  buildDemoHtml,
};
