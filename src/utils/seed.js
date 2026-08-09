require('dotenv').config();

const connectDB = require('../config/db');
const {
  User,
  ROLES,
  Store,
  INTEGRATION_TYPES,
  Product,
  StoreProduct,
  PriceHistory,
  SCRAPE_STATUS,
} = require('../models');
const { createSlug, normalizeTitle } = require('./helpers');
const { catalog, STORE_LOGOS } = require('../integrations/demo/demoCatalog');
const logger = require('./logger');
const config = require('../config');

const productUrlFor = (storeKey, externalId) => {
  if (config.scraper.mode === 'http' || config.scraper.mode === 'auto') {
    return `${config.scraper.fixtureBase}/${storeKey}/p/${externalId}`;
  }
  return `https://demo.${storeKey}.example/p/${externalId}`;
};

const seed = async () => {
  await connectDB();

  logger.info('Seeding database...');

  await Promise.all([
    User.deleteMany({}),
    Store.deleteMany({}),
    Product.deleteMany({}),
    StoreProduct.deleteMany({}),
    PriceHistory.deleteMany({}),
  ]);

  const Watchlist = require('../models/Watchlist');
  const { PriceAlert } = require('../models/PriceAlert');
  const { Notification } = require('../models/Notification');
  const Deal = require('../models/Deal');
  await Promise.all([
    Watchlist.deleteMany({}),
    PriceAlert.deleteMany({}),
    Notification.deleteMany({}),
    Deal.deleteMany({}),
  ]);

  const admin = await User.create({
    name: process.env.ADMIN_NAME || 'Admin',
    email: process.env.ADMIN_EMAIL || 'admin@pricecompare.local',
    password: process.env.ADMIN_PASSWORD || 'Admin@12345',
    role: ROLES.ADMIN,
  });

  const demoUser = await User.create({
    name: 'Demo User',
    email: 'user@pricecompare.local',
    password: 'User@12345',
    role: ROLES.USER,
  });

  const storeDefs = [
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

  const stores = {};
  for (const def of storeDefs) {
    stores[def.slug] = await Store.create({ ...def, isActive: true });
  }

  const dealCandidates = [];
  let storeProductCount = 0;

  for (const item of catalog) {
    const product = await Product.create({
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
        .map(([name, value]) => ({
          name,
          value: String(value),
        })),
      slug: createSlug(item.title),
      normalizedTitle: normalizeTitle(item.title),
      isActive: true,
    });

    for (const [storeKey, storeEntry] of Object.entries(item.stores)) {
      if (!storeEntry || !stores[storeKey]) continue;

      const now = new Date();
      const discount = Math.round(((item.mrp - storeEntry.basePrice) / item.mrp) * 100);
      const sp = await StoreProduct.create({
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
        lastFailedFetchAt: null,
        scrapeStatus: SCRAPE_STATUS.SUCCESS,
        consecutiveFailureCount: 0,
        lastError: null,
        lastCheckStatus: 'SUCCESS',
        isActive: true,
      });

      storeProductCount += 1;

      await PriceHistory.create({
        productId: product._id,
        storeProductId: sp._id,
        storeId: stores[storeKey]._id,
        previousPrice: null,
        newPrice: storeEntry.basePrice,
        priceDifference: null,
        percentageChange: null,
        availability: 'IN_STOCK',
        changeType: 'INITIAL',
        isHistoricalLow: true,
        dropSeverity: 'NONE',
        recordedAt: now,
      });

      // Second history point — small drop so charts / history UI look real
      const earlier = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      await PriceHistory.create({
        productId: product._id,
        storeProductId: sp._id,
        storeId: stores[storeKey]._id,
        previousPrice: Math.round(storeEntry.basePrice * 1.04),
        newPrice: storeEntry.basePrice,
        priceDifference: Math.round(storeEntry.basePrice - storeEntry.basePrice * 1.04),
        percentageChange: -3.85,
        availability: 'IN_STOCK',
        changeType: 'DECREASE',
        isHistoricalLow: true,
        dropSeverity: 'NORMAL',
        recordedAt: earlier,
      });

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

  // Keep top deals by discount
  dealCandidates.sort((a, b) => b.discountPercent - a.discountPercent);
  const deals = await Deal.insertMany(dealCandidates.slice(0, 6));

  logger.info('Seed completed', {
    admin: admin.email,
    user: demoUser.email,
    stores: Object.keys(stores).length,
    products: catalog.length,
    storeProducts: storeProductCount,
    deals: deals.length,
    sampleImage: catalog[0].images[0],
  });

  process.exit(0);
};

seed().catch((err) => {
  logger.error('Seed failed', { error: err.message, stack: err.stack });
  process.exit(1);
});
