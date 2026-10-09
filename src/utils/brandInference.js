const { brandCatalog } = require('../data/brandCatalog');

/**
 * Store search results rarely include a brand field, but titles almost always start with it
 * ("boAt Airdopes 141…", "LAKME 9to5 …"). Match the title's leading words against the brand
 * catalog (longest name wins) to recover brand + category.
 */
const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // Lakmé → Lakme
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9&]+/g, ' ')
    .trim();

// Longest names first so "Tommy Hilfiger" beats "Tommy", "Bajaj Electricals" beats "Bajaj"
const ENTRIES = brandCatalog
  .flatMap((b) => [...new Set([b.name, b.searchKeyword].filter(Boolean))].map((alias) => ({ key: norm(alias), b })))
  .filter((e) => e.key.length >= 2)
  .sort((a, z) => z.key.length - a.key.length);

/** @returns {{ name: string, category: string } | null} */
const inferBrand = (title) => {
  const t = ` ${norm(title)} `;
  const head = t.slice(0, 48); // brand is at (or very near) the start of the title
  for (const { key, b } of ENTRIES) {
    if (head.startsWith(` ${key} `)) return { name: b.name, category: b.category };
  }
  return null;
};

module.exports = { inferBrand };
