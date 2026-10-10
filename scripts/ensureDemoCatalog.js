/**
 * Add shopper-visible demo catalog data without wiping existing collections.
 * Safe to re-run (upserts by slug / store+external id).
 *
 *   node scripts/ensureDemoCatalog.js
 */
require('dotenv').config();

const connectDB = require('../src/config/db');
const {
  User,
  ROLES,
  Store,
  INTEGRATION_TYPES,
  Product,
  StoreProduct,
  PriceHistory,
  Brand,
  Deal,
  SCRAPE_STATUS,
} = require('../src/models');
const { createSlug, normalizeTitle } = require('../src/utils/helpers');
const { catalog, STORE_LOGOS } = require('../src/integrations/demo/demoCatalog');
const logger = require('../src/utils/logger');
const config = require('../src/config');

const productUrlFor = (storeKey, externalId) => {
  if (config.scraper.mode === 'http' || config.scraper.mode === 'auto') {
    return `${config.scraper.fixtureBase}/${storeKey}/p/${externalId}`;
  }
  return `https://demo.${storeKey}.example/p/${externalId}`;
};

const STORE_DEFS = [
  {
    name: 'Amazon',
    slug: 'amazon',
    domain: 'amazon.in',
    logo: STORE_LOGOS.amazon,
    integrationType: INTEGRATION_TYPES.PLAYWRIGHT,
  },
  {
    name: 'Flipkart',
    slug: 'flipkart',
    domain: 'flipkart.com',
    logo: STORE_LOGOS.flipkart,
    integrationType: INTEGRATION_TYPES.PLAYWRIGHT,
  },
  {
    name: 'Myntra',
    slug: 'myntra',
    domain: 'myntra.com',
    logo: STORE_LOGOS.myntra,
    integrationType: INTEGRATION_TYPES.DEMO_FEED,
  },
  {
    name: 'Croma',
    slug: 'croma',
    domain: 'croma.com',
    logo: STORE_LOGOS.croma,
    integrationType: INTEGRATION_TYPES.PLAYWRIGHT,
  },
];

const upsertUser = async ({ name, email, password, role }) => {
  const existing = await User.findOne({ email });
  if (existing) return existing;
  return User.create({ name, email, password, role });
};

const run = async () => {
  await connectDB();
  logger.info('Ensuring demo catalog (no deletes)...');

  const admin = await upsertUser({
    name: process.env.ADMIN_NAME || 'Admin',
    email: process.env.ADMIN_EMAIL || 'admin@pricecompare.local',
    password: process.env.ADMIN_PASSWORD || 'demo@123',
    role: ROLES.ADMIN,
  });
  const demoUser = await upsertUser({
    name: 'Demo User',
    email: 'user@pricecompare.local',
    password: 'User@12345',
    role: ROLES.USER,
  });

  const stores = {};
  for (const def of STORE_DEFS) {
    stores[def.slug] = await Store.findOneAndUpdate(
      { slug: def.slug },
      { $set: { ...def, isActive: true } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  }

  const dealCandidates = [];
  let storeProductCount = 0;
  const productIds = [];

  for (const item of catalog) {
    const slug = createSlug(item.title);
    const product = await Product.findOneAndUpdate(
      { slug },
      {
        $set: {
          title: item.title,
          brand: item.brand,
          category: item.category,
          subCategory: item.subCategory,
          description: item.description || `${item.title} — seeded demo product`,
          images: item.images,
          identifiers: { modelNumber: item.modelNumber },
          attributes: item.attributes,
          variants: Object.entries(item.attributes || {})
            .filter(([, value]) => value != null && value !== '')
            .map(([name, value]) => ({ name, value: String(value) })),
          slug,
          normalizedTitle: normalizeTitle(item.title),
          isActive: true,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    productIds.push(product._id);

    for (const [storeKey, storeEntry] of Object.entries(item.stores)) {
      if (!storeEntry || !stores[storeKey]) continue;

      const now = new Date();
      const discount = Math.round(((item.mrp - storeEntry.basePrice) / item.mrp) * 100);
      const sp = await StoreProduct.findOneAndUpdate(
        { storeId: stores[storeKey]._id, externalProductId: storeEntry.externalId },
        {
          $set: {
            productId: product._id,
            storeId: stores[storeKey]._id,
            externalProductId: storeEntry.externalId,
            title: storeEntry.title,
            productUrl: productUrlFor(storeKey, storeEntry.externalId),
            affiliateUrl: productUrlFor(storeKey, storeEntry.externalId),
            seller: storeEntry.seller,
            currentPrice: storeEntry.basePrice,
            previousPrice: Math.round(storeEntry.basePrice * 1.04),
            mrp: item.mrp,
            discount,
            currency: 'INR',
            availability: 'IN_STOCK',
            rating: storeEntry.rating ?? 4.4,
            reviewCount: storeEntry.reviewCount ?? 1500,
            images: item.images,
            variant: item.attributes,
            lastCheckedAt: now,
            lastSuccessfulFetchAt: now,
            scrapeStatus: SCRAPE_STATUS.SUCCESS,
            consecutiveFailureCount: 0,
            lastError: null,
            lastCheckStatus: 'SUCCESS',
            isActive: true,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      storeProductCount += 1;

      const historyCount = await PriceHistory.countDocuments({ storeProductId: sp._id });
      if (historyCount === 0) {
        await PriceHistory.create({
          productId: product._id,
          storeProductId: sp._id,
          storeId: stores[storeKey]._id,
          previousPrice: null,
          newPrice: storeEntry.basePrice,
          changeType: 'INITIAL',
          isHistoricalLow: true,
          dropSeverity: 'NONE',
          availability: 'IN_STOCK',
          recordedAt: now,
        });
        await PriceHistory.create({
          productId: product._id,
          storeProductId: sp._id,
          storeId: stores[storeKey]._id,
          previousPrice: Math.round(storeEntry.basePrice * 1.04),
          newPrice: storeEntry.basePrice,
          priceDifference: Math.round(storeEntry.basePrice - storeEntry.basePrice * 1.04),
          percentageChange: -3.85,
          changeType: 'DECREASE',
          isHistoricalLow: true,
          dropSeverity: 'NORMAL',
          availability: 'IN_STOCK',
          recordedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
        });
      }

      if (discount >= 10) {
        dealCandidates.push({
          productId: product._id,
          storeProductId: sp._id,
          storeId: stores[storeKey]._id,
          title: storeEntry.title,
          description: `Save ${discount}% vs MRP on ${item.brand}`,
          previousPrice: item.mrp,
          currentPrice: storeEntry.basePrice,
          discountPercent: discount,
          dropSeverity: discount >= 20 ? 'MAJOR' : 'SIGNIFICANT',
          isHistoricalLow: true,
          isActive: true,
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        });
      }
    }
  }

  dealCandidates.sort((a, b) => b.discountPercent - a.discountPercent);
  let dealsCreated = 0;
  for (const deal of dealCandidates.slice(0, 6)) {
    const existing = await Deal.findOne({ storeProductId: deal.storeProductId, isActive: true });
    if (existing) continue;
    await Deal.create(deal);
    dealsCreated += 1;
  }

  const brandCounts = {};
  for (const item of catalog) {
    if (!item.brand) continue;
    if (!brandCounts[item.brand]) {
      brandCounts[item.brand] = { count: 0, category: item.category || 'Electronics' };
    }
    brandCounts[item.brand].count += 1;
  }
  for (const [name, meta] of Object.entries(brandCounts)) {
    await Brand.findOneAndUpdate(
      { slug: createSlug(name) },
      {
        $set: {
          name,
          slug: createSlug(name),
          category: meta.category,
          searchKeyword: name,
          scrapeStatus: 'done',
          lastScrapedAt: new Date(),
          savedCount: meta.count,
          isActive: true,
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }

  const { refreshProductSummaries, invalidateStores } = require('../src/services/productSummaryService');
  invalidateStores();
  await refreshProductSummaries(productIds);

  logger.info('Demo catalog ready', {
    admin: admin.email,
    user: demoUser.email,
    stores: Object.keys(stores).length,
    products: productIds.length,
    storeProducts: storeProductCount,
    dealsCreated,
  });

  process.exit(0);
};

run().catch((err) => {
  logger.error('ensureDemoCatalog failed', { error: err.message, stack: err.stack });
  process.exit(1);
});
