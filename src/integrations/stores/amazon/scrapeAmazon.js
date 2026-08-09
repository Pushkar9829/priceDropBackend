/**
 * Amazon-first scrape runner.
 *
 * With Creators API credentials → live Amazon catalog prices (official).
 * Without credentials → Amazon-only fixture HTTP scrape (local pipeline test).
 *
 * Usage:
 *   npm run fixtures          # Terminal A (fixture mode only)
 *   npm run scrape:amazon     # Terminal B
 */
require('dotenv').config();

const connectDB = require('../../../config/db');
const config = require('../../../config');
const logger = require('../../../utils/logger');
const { Store, StoreProduct } = require('../../../models');
const { createIntegration } = require('../../index');
const priceMonitoringService = require('../../../services/priceMonitoringService');
const creatorsApi = require('./amazon.creatorsApi');
const { fetchHtml } = require('../base/httpClient');
const AmazonParser = require('./amazon.parser');

const run = async () => {
  const live = creatorsApi.isConfigured();

  logger.info('Amazon scrape starting', {
    mode: live ? 'CREATORS_API' : config.scraper.mode,
    marketplace: config.amazon.marketplace,
    liveApi: live,
  });

  if (!live) {
    logger.warn(
      'No AMAZON_CREDENTIAL_* env vars — using fixture HTML for Amazon only. ' +
        'Add Creators API credentials for live amazon.in prices.'
    );

    try {
      await fetchHtml(`${config.scraper.fixtureBase}/health`);
    } catch (err) {
      logger.error('Start the fixture storefront first: npm run fixtures', {
        error: err.message,
      });
      process.exit(1);
    }

    const sampleUrl = `${config.scraper.fixtureBase}/amazon/p/AMZ-IP16-128`;
    const { html } = await fetchHtml(sampleUrl);
    const parsed = new AmazonParser().parseProductPage(html);
    logger.info('Amazon Cheerio parse OK', {
      title: parsed.title,
      price: parsed.currentPrice,
    });
  }

  await connectDB();

  const amazon = await Store.findOne({ slug: 'amazon', isActive: true });
  if (!amazon) {
    throw new Error('Amazon store missing — run npm run seed');
  }

  const adapter = createIntegration(amazon);
  const listings = await StoreProduct.find({
    storeId: amazon._id,
    isActive: true,
  }).limit(20);

  if (!listings.length) {
    throw new Error('No Amazon store products — run npm run seed');
  }

  // Smoke-test first listing
  const first = listings[0];
  const productUrl = live
    ? first.productUrl || adapter.buildProductUrl(first.externalProductId)
    : `${config.scraper.fixtureBase}/amazon/p/${first.externalProductId}`;

  if (!live) {
    for (const listing of listings) {
      listing.productUrl = `${config.scraper.fixtureBase}/amazon/p/${listing.externalProductId}`;
      await listing.save();
    }
  }

  try {
    const details = await adapter.getProductDetails(first.externalProductId, {
      productUrl,
    });
    logger.info('Amazon adapter OK', {
      externalProductId: first.externalProductId,
      title: details.title,
      price: details.currentPrice,
      collectionMethod: details.collectionMethod,
    });
  } catch (err) {
    logger.error('Amazon adapter smoke test failed', {
      externalProductId: first.externalProductId,
      error: err.message,
      code: err.code,
    });
    if (live) {
      logger.error(
        'Check AMAZON_CREDENTIAL_ID / SECRET / VERSION / PARTNER_TAG. ' +
          'ASINs must be real marketplace ASINs (e.g. B0xxxxxxx), not demo IDs.'
      );
    }
    process.exitCode = 1;
  }

  const summary = await priceMonitoringService.runPriceMonitoring({
    forceAll: true,
    storeId: amazon._id,
  });

  logger.info('Amazon monitoring completed', summary);

  if (summary.failed === summary.total && summary.total > 0) {
    process.exitCode = 1;
  }

  if (!process.exitCode) {
    logger.info(
      live
        ? 'AMAZON_SCRAPE_PASS — Creators API → Mongo updated'
        : 'AMAZON_SCRAPE_PASS — fixture HTTP → Cheerio → Mongo (Amazon only)'
    );
  }

  process.exit(process.exitCode || 0);
};

run().catch((err) => {
  logger.error('Amazon scrape failed', { error: err.message, stack: err.stack });
  process.exit(1);
});
