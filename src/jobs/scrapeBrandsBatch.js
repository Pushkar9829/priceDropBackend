/**
 * Batch brand scrape — one brand at a time across Amazon + Flipkart.
 *
 * Requires:
 *   SCRAPER_MODE=http
 *   SCRAPER_ENABLE_PLAYWRIGHT=true
 *   npx playwright install chromium
 *   MongoDB running (MONGODB_URI)
 *
 * Usage:
 *   npm run scrape:brands                         # seed catalog + scrape all pending brands
 *   npm run scrape:brands -- --seed-only          # upsert brand catalog only
 *   npm run scrape:brands -- --limit-brands 3     # process next 3 pending brands then exit
 *   npm run scrape:brands -- --brand logitech     # scrape one brand by slug (or name)
 *   npm run scrape:brands -- --resume             # include failed brands in the queue
 *   npm run scrape:brands -- --stores amazon,flipkart --per-store 1000
 *   npm run scrape:brands -- --dry-run            # search only, do not write products
 *   npm run scrape:brands -- --no-continue-on-error  # stop queue on first brand failure
 */
require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const config = require('../config');
const logger = require('../utils/logger');
const { Brand, Store } = require('../models');
const { upsertBrandCatalog } = require('../utils/seedBrands');
const {
  scrapeStoresByKeyword,
  KEYWORD_SCRAPE_MAX,
} = require('../services/adminService');
const { closeBrowser } = require('../integrations/stores/base/browserClient');
const { createSlug } = require('../utils/helpers');

const BRAND_STORES = ['amazon', 'flipkart'];

const argValue = (flag) => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return null;
  return process.argv[idx + 1];
};

const hasFlag = (flag) => process.argv.includes(flag);

const parseStores = (raw) => {
  if (!raw) return [...BRAND_STORES];
  return String(raw)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => BRAND_STORES.includes(s));
};

/**
 * Process a single brand sequentially across stores.
 */
const scrapeOneBrand = async (brand, { stores, perStore, dryRun }) => {
  brand.scrapeStatus = 'running';
  brand.lastError = '';
  await brand.save();

  logger.info('Brand scrape started', {
    brand: brand.name,
    slug: brand.slug,
    keyword: brand.searchKeyword,
    category: brand.category,
    stores,
    perStore,
    dryRun,
  });

  let amazonFound = brand.amazonFound || 0;
  let flipkartFound = brand.flipkartFound || 0;
  let savedCount = 0;
  const storeErrors = [];

  try {
    for (const storeSlug of stores) {
      const storeDoc = await Store.findOne({ slug: storeSlug, isActive: true });
      if (!storeDoc) {
        storeErrors.push({ store: storeSlug, error: 'Store missing or inactive' });
        logger.warn('Skipping store — missing or inactive', { store: storeSlug });
        continue;
      }

      if (dryRun) {
        const { createIntegration } = require('../integrations');
        const integration = createIntegration(storeDoc);
        const items = await integration.scraper.searchLive(brand.searchKeyword, {
          limit: perStore,
          maxPages: Math.min(120, Math.ceil(perStore / 10) + 3),
        });
        if (storeSlug === 'amazon') amazonFound = items.length;
        if (storeSlug === 'flipkart') flipkartFound = items.length;
        logger.info('Dry-run search complete', {
          brand: brand.name,
          store: storeSlug,
          found: items.length,
        });
        continue;
      }

      const summary = await scrapeStoresByKeyword({
        query: brand.searchKeyword,
        limit: perStore,
        stores: [storeSlug],
        forcedBrand: brand.name,
        category: brand.category,
        closeBrowserWhenDone: false,
      });

      const by = summary.byStore?.[storeSlug] || {};
      if (storeSlug === 'amazon') amazonFound = by.found || 0;
      if (storeSlug === 'flipkart') flipkartFound = by.found || 0;
      savedCount += by.saved || 0;

      if (by.errors?.length) {
        for (const e of by.errors.slice(0, 5)) {
          storeErrors.push({ store: storeSlug, ...e });
        }
      }

      logger.info('Brand store scrape finished', {
        brand: brand.name,
        store: storeSlug,
        found: by.found,
        saved: by.saved,
        skipped: by.skipped,
      });
    }

    brand.amazonFound = amazonFound;
    brand.flipkartFound = flipkartFound;
    brand.savedCount = dryRun ? brand.savedCount || 0 : (brand.savedCount || 0) + savedCount;
    brand.lastScrapedAt = new Date();
    // Dry-run must not advance the queue
    brand.scrapeStatus = dryRun ? 'pending' : 'done';
    brand.lastError = storeErrors.length
      ? storeErrors
          .slice(0, 3)
          .map((e) => `${e.store}: ${e.error || e.title || 'error'}`)
          .join('; ')
      : '';
    await brand.save();

    return {
      ok: true,
      brand: brand.slug,
      amazonFound,
      flipkartFound,
      savedCount,
      errors: storeErrors,
    };
  } catch (err) {
    brand.scrapeStatus = 'failed';
    brand.lastError = err.message;
    brand.lastScrapedAt = new Date();
    brand.amazonFound = amazonFound;
    brand.flipkartFound = flipkartFound;
    await brand.save();
    logger.error('Brand scrape failed', {
      brand: brand.name,
      slug: brand.slug,
      error: err.message,
    });
    return { ok: false, brand: brand.slug, error: err.message };
  } finally {
    await closeBrowser().catch(() => {});
  }
};

const findBrandTarget = async (brandArg) => {
  const raw = String(brandArg || '').trim();
  if (!raw) return null;
  const slug = createSlug(raw);
  return (
    (await Brand.findOne({ slug })) ||
    (await Brand.findOne({ name: new RegExp(`^${raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }))
  );
};

const run = async () => {
  logger.info('Brand batch scrape starting', {
    mode: config.scraper.mode,
    playwright: config.scraper.enablePlaywright,
  });

  const seedOnly = hasFlag('--seed-only');
  const dryRun = hasFlag('--dry-run');
  const resume = hasFlag('--resume');
  const continueOnError = !hasFlag('--no-continue-on-error');
  const brandArg = argValue('--brand');
  const limitBrandsRaw = argValue('--limit-brands');
  const limitBrands = limitBrandsRaw ? Math.max(1, parseInt(limitBrandsRaw, 10) || 1) : null;
  const perStore = Math.min(
    KEYWORD_SCRAPE_MAX,
    Math.max(1, parseInt(argValue('--per-store') || String(KEYWORD_SCRAPE_MAX), 10) || KEYWORD_SCRAPE_MAX)
  );
  const stores = parseStores(argValue('--stores'));

  if (!stores.length) {
    logger.error('No valid stores. Use --stores amazon,flipkart');
    process.exit(1);
  }

  await connectDB();
  const catalogStats = await upsertBrandCatalog();
  logger.info('Brand catalog ready', catalogStats);

  if (seedOnly) {
    process.exitCode = 0;
    return;
  }

  if (config.scraper.mode === 'demo') {
    logger.error('Set SCRAPER_MODE=http in .env for live brand batch scraping.');
    process.exit(1);
  }

  if (!config.scraper.enablePlaywright) {
    logger.error('Set SCRAPER_ENABLE_PLAYWRIGHT=true in .env — brand batch needs Playwright.');
    process.exit(1);
  }

  const results = [];

  if (brandArg) {
    const brand = await findBrandTarget(brandArg);
    if (!brand) {
      logger.error('Brand not found in catalog', { brand: brandArg });
      process.exitCode = 1;
      return;
    }
    // Allow re-scrape of a specific brand regardless of prior status
    const result = await scrapeOneBrand(brand, { stores, perStore, dryRun });
    results.push(result);
    if (!result.ok) process.exitCode = 1;
  } else {
    const statuses = resume ? ['pending', 'failed'] : ['pending'];
    const filter = { isActive: true, scrapeStatus: { $in: statuses } };
    let processed = 0;
    const seenIds = new Set();

    // Reset stuck "running" brands from a crashed prior run
    await Brand.updateMany(
      { scrapeStatus: 'running' },
      { $set: { scrapeStatus: 'failed', lastError: 'Interrupted — reset by scrape:brands' } }
    );

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (limitBrands != null && processed >= limitBrands) break;

      const query = { ...filter };
      if (seenIds.size) {
        query._id = { $nin: [...seenIds] };
      }

      const brand = await Brand.findOne(query).sort({ category: 1, name: 1 });
      if (!brand) {
        logger.info('No more brands in queue', { statuses });
        break;
      }

      seenIds.add(String(brand._id));
      const result = await scrapeOneBrand(brand, { stores, perStore, dryRun });
      results.push(result);
      processed += 1;

      if (!result.ok && !continueOnError) {
        logger.error('Stopping queue after brand failure (--no-continue-on-error)');
        process.exitCode = 1;
        break;
      }
    }
  }

  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  logger.info('Brand batch scrape finished', {
    processed: results.length,
    ok,
    failed,
    dryRun,
  });
  console.log(
    JSON.stringify(
      {
        processed: results.length,
        ok,
        failed,
        results: results.map((r) => ({
          brand: r.brand,
          ok: r.ok,
          amazonFound: r.amazonFound,
          flipkartFound: r.flipkartFound,
          savedCount: r.savedCount,
          error: r.error,
        })),
      },
      null,
      2
    )
  );

  if (failed && !process.exitCode) process.exitCode = 1;
};

run()
  .catch((err) => {
    logger.error('Brand batch scrape crashed', { error: err.message, stack: err.stack });
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeBrowser().catch(() => {});
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  });
