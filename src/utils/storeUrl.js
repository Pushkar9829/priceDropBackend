/**
 * Strict store-URL checks. A URL counts as a store's only when it parses, uses http(s),
 * carries no credentials and its hostname IS the store domain (or a subdomain of it).
 * Regex prefix checks are not enough: "https://flipkart.com@169.254.169.254/" and
 * "https://flipkart.com.evil.io/" both start with "https://flipkart.com".
 */
const STORE_DOMAINS = {
  flipkart: ['flipkart.com'],
  amazon: ['amazon.in', 'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.co.jp'],
  croma: ['croma.com'],
};

const parseHttpUrl = (url) => {
  try {
    const u = new URL(String(url || '').trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
};

const hostMatches = (url, domains) => {
  const u = parseHttpUrl(url);
  if (!u) return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
};

const isStoreUrl = (slug, url) => hostMatches(url, STORE_DOMAINS[slug] || []);

/** Store slug for a live product URL, or null if it isn't one of ours. */
const detectStoreSlug = (url) => Object.keys(STORE_DOMAINS).find((slug) => isStoreUrl(slug, url)) || null;

module.exports = { STORE_DOMAINS, parseHttpUrl, isStoreUrl, detectStoreSlug };
