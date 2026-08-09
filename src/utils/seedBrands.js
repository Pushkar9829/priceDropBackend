const Brand = require('../models/Brand');
const { brandCatalog } = require('../data/brandCatalog');
const logger = require('../utils/logger');

/**
 * Upsert all catalog brands into MongoDB without wiping scrape progress
 * for brands that already exist (preserves scrapeStatus / counters).
 */
const upsertBrandCatalog = async () => {
  let created = 0;
  let updated = 0;

  for (const entry of brandCatalog) {
    const existing = await Brand.findOne({ slug: entry.slug });
    if (existing) {
      existing.name = entry.name;
      existing.category = entry.category;
      existing.searchKeyword = entry.searchKeyword;
      existing.isActive = true;
      await existing.save();
      updated += 1;
    } else {
      await Brand.create({
        name: entry.name,
        slug: entry.slug,
        category: entry.category,
        searchKeyword: entry.searchKeyword,
        scrapeStatus: 'pending',
        isActive: true,
      });
      created += 1;
    }
  }

  logger.info('Brand catalog upserted', {
    total: brandCatalog.length,
    created,
    updated,
  });

  return { total: brandCatalog.length, created, updated };
};

module.exports = { upsertBrandCatalog };
