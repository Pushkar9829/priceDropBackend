/**
 * Flipkart live scrape runner (no affiliate API).
 *
 * Requires:
 *   SCRAPER_MODE=http
 *   SCRAPER_ENABLE_PLAYWRIGHT=true
 *   npx playwright install chromium
 *
 * Usage:
 *   npm run scrape:flipkart
 *   npm run scrape:flipkart -- --url "https://www.flipkart.com/.../p/itm...?pid=..."
 *   npm run scrape:flipkart -- --search "iphone 16" --limit 5
 *   npm run scrape:flipkart -- --monitor   # refresh Flipkart StoreProducts that have live URLs
 */
require('dotenv').config();

const connectDB = require('../../../config/db');
const config = require('../../../config');
const logger = require('../../../utils/logger');
const { Store, StoreProduct } = require('../../../models');
const { createIntegration } = require('../../index');
const priceMonitoringService = require('../../../services/priceMonitoringService');
const FlipkartScraper = require('./flipkart.scraper');
const { isLiveFlipkartUrl } = require('./flipkart.scraper');
const { closeBrowser } = require('../base/browserClient');

const argValue = (flag) => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return null;
  return process.argv[idx + 1];
};

const hasFlag = (flag) => process.argv.includes(flag);

const run = async () => {
  logger.info('Flipkart scrape starting', {
    mode: config.scraper.mode,
    playwright: config.scraper.enablePlaywright,
  });

  if (config.scraper.mode === 'demo') {
    logger.error('Set SCRAPER_MODE=http in .env for live Flipkart scraping (demo short-circuits).');
    process.exit(1);
  }

  if (!config.scraper.enablePlaywright) {
    logger.error('Set SCRAPER_ENABLE_PLAYWRIGHT=true in .env — Flipkart live pages need Playwright.');
    process.exit(1);
  }

  const url = argValue('--url');
  const search = argValue('--search');
  const limit = Number(argValue('--limit') || 5);
  const monitor = hasFlag('--monitor');

  const scraper = new FlipkartScraper();

  try {
    if (search) {
      const results = await scraper.searchLive(search, { limit });
      logger.info('Flipkart search OK', { query: search, count: results.length });
      console.log(JSON.stringify({ query: search, count: results.length, results }, null, 2));
      process.exitCode = results.length ? 0 : 1;
      return;
    }

    if (url) {
      if (!isLiveFlipkartUrl(url)) {
        throw new Error('--url must be a https://www.flipkart.com/... product link');
      }
      const product = await scraper.fromPlaywright(url);
      logger.info('Flipkart product OK', {
        title: product.title,
        price: product.currentPrice,
        pid: product.externalProductId,
      });
      console.log(JSON.stringify(product, null, 2));
      if (!product.currentPrice) process.exitCode = 1;
      return;
    }

    // Default: smoke-test via adapter + optional monitoring of live-URL listings
    await connectDB();

    const flipkart = await Store.findOne({ slug: 'flipkart', isActive: true });
    if (!flipkart) {
      throw new Error('Flipkart store missing — run npm run seed');
    }

    const adapter = createIntegration(flipkart);

    const sampleUrl =
      argValue('--sample-url') ||
      'https://www.flipkart.com/apple-iphone-16-pink-128-gb/p/itmc2e910b4d0b1c?pid=MOBH4DQFWJVDRSHM';

    const details = await adapter.getProductDetails('MOBH4DQFWJVDRSHM', {
      productUrl: sampleUrl,
    });

    logger.info('Flipkart adapter OK', {
      title: details.title,
      price: details.currentPrice,
      method: details.collectionMethod,
      availability: details.availability,
    });
    console.log(JSON.stringify(details, null, 2));

    if (monitor) {
      const liveListings = await StoreProduct.find({
        storeId: flipkart._id,
        isActive: true,
        productUrl: /flipkart\.com/i,
      }).limit(20);

      if (!liveListings.length) {
        logger.warn(
          'No StoreProducts with live flipkart.com URLs. ' +
            'Update productUrl on listings (seed uses fixture URLs by default).'
        );
      } else {
        const summary = await priceMonitoringService.runPriceMonitoring({
          force: true,
          storeId: flipkart._id,
        });
        logger.info('Flipkart monitoring completed', summary);
        if (summary.failed === summary.total && summary.total > 0) {
          process.exitCode = 1;
        }
      }
    }

    if (!details.currentPrice) process.exitCode = 1;
    else logger.info('FLIPKART_SCRAPE_PASS — Playwright → Cheerio → adapter');
  } finally {
    await closeBrowser();
  }

  process.exit(process.exitCode || 0);
};

run().catch(async (err) => {
  logger.error('Flipkart scrape failed', { error: err.message, stack: err.stack });
  await closeBrowser();
  process.exit(1);
});
