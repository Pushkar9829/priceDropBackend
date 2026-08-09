const slugify = require('slugify');

const createSlug = (text) =>
  slugify(text || '', { lower: true, strict: true, trim: true });

const normalizeTitle = (title = '') =>
  title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(\d+)\s*(gb|tb|mb|ram|inch|cm)\b/gi, '$1$2')
    .trim();

const extractStorage = (text = '') => {
  const match = text.toLowerCase().match(/(\d+)\s*(tb|gb)/i);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  return unit === 'tb' ? value * 1024 : value;
};

const extractRam = (text = '') => {
  const match = text.toLowerCase().match(/(\d+)\s*gb\s*ram/i);
  return match ? parseInt(match[1], 10) : null;
};

const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

const calcPercentageChange = (previous, current) => {
  if (previous == null || previous === 0 || current == null) return null;
  return round2(((current - previous) / previous) * 100);
};

const calcPriceDifference = (previous, current) => {
  if (previous == null || current == null) return null;
  return round2(current - previous);
};

module.exports = {
  createSlug,
  normalizeTitle,
  extractStorage,
  extractRam,
  round2,
  calcPercentageChange,
  calcPriceDifference,
};
