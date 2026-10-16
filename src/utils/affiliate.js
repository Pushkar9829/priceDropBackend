
const ALREADY_TRACKED = /(^|\.)(linksredirect\.com|clnk\.in)$/i;

/**
 * Where a "buy" link should point (mirrors frontend/src/lib/affiliate.js): an admin-set
 * affiliate URL wins, otherwise the store URL wrapped in the Cuelinks redirect. `subid`
 * tags the click's origin so Cuelinks reports can split earnings by placement.
 */
const outboundUrl = (listing, subid) => {
  if (!listing) return '';
  if (listing.affiliateUrl) return listing.affiliateUrl;
  const url = listing.productUrl;
  if (!url) return '';
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return url;
  }
  // Lazy require: settingsService → models → … must not load during config bootstrap
  const cid = require('../services/settingsService').peekAffiliateSettings().cuelinks.cid;
  if (!cid || ALREADY_TRACKED.test(host)) return url;
  const sub = subid ? `&subid=${encodeURIComponent(subid)}` : '';
  return `https://linksredirect.com/?cid=${encodeURIComponent(cid)}${sub}&source=js&url=${encodeURIComponent(url)}`;
};

module.exports = { outboundUrl };
