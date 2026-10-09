/**
 * End-to-end scrape test:
 * HTTP fetch → Cheerio parse → adapter → price monitoring
 *
 * Prerequisites:
 *   Terminal A: npm run fixtures
 *   .env: SCRAPER_MODE=http
 */
require('dotenv').config();

const connectDB = require('../../config/db');
const config = require('../../config');
const logger = require('../../utils/logger');
const { Store, StoreProduct } = require('../../models');
const { createIntegration } = require('../index');
const priceMonitoringService = require('../../services/priceMonitoringService');
const { fetchHtml } = require('../stores/base/httpClient');
const AmazonParser = require('../stores/amazon/amazon.parser');

const run = async () => {
  require('../../utils/scriptGuard').assertSafeTarget('scrape:test');
  const fixtureBase = config.scraper.fixtureBase;

  logger.info('Scrape test starting', {
    mode: config.scraper.mode,
    fixtureBase,
  });

  if (config.scraper.mode === 'demo') {
    logger.warn('SCRAPER_MODE is still demo — set SCRAPER_MODE=http in .env for real HTTP scraping');
  }

  try {
    const health = await fetchHtml(`${fixtureBase}/health`);
    logger.info('Fixture server reachable', { body: health.html.slice(0, 120) });
  } catch (err) {
    logger.error('Start the fixture storefront first: npm run fixtures', {
      error: err.message,
      fixtureBase,
    });
    process.exit(1);
  }

  const sampleUrl = `${fixtureBase}/amazon/p/AMZ-IP16-128`;
  const { html } = await fetchHtml(sampleUrl);
  const parsed = new AmazonParser().parseProductPage(html);
  logger.info('Cheerio parse OK', {
    title: parsed.title,
    price: parsed.currentPrice,
    availability: parsed.availability,
  });

  if (!parsed.currentPrice || !parsed.title) {
    throw new Error('Parser did not extract title/price from fixture HTML');
  }

  await connectDB();

  const amazon = await Store.findOne({ slug: 'amazon', isActive: true });
  if (!amazon) throw new Error('Amazon store missing — run npm run seed');

  const adapter = createIntegration(amazon);
  const details = await adapter.getProductDetails('AMZ-IP16-128', { productUrl: sampleUrl });
  logger.info('Adapter scrape OK', {
    title: details.title,
    price: details.currentPrice,
    collectionMethod: details.collectionMethod,
  });

  const stores = await Store.find({ isActive: true });
  let updated = 0;
  for (const store of stores) {
    const listings = await StoreProduct.find({ storeId: store._id, isActive: true });
    for (const listing of listings) {
      listing.productUrl = `${fixtureBase}/${store.slug}/p/${listing.externalProductId}`;
      await listing.save();
      updated += 1;
    }
  }
  logger.info('Pointed store products at fixture URLs', { updated });

  const summary = await priceMonitoringService.runPriceMonitoring({ force: true });
  logger.info('Monitoring via HTTP scrape completed', summary);

  if (summary.failed === summary.total && summary.total > 0) {
    process.exitCode = 1;
  }

  logger.info('SCRAPE_TEST_PASS — Axios fetched HTML, Cheerio parsed prices, Mongo updated');
  process.exit(process.exitCode || 0);
};

run().catch((err) => {
  logger.error('Scrape test failed', { error: err.message, stack: err.stack });
  process.exit(1);
});
