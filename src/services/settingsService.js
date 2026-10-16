const config = require('../config');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const SiteSetting = require('../models/SiteSetting');

/**
 * Affiliate settings the admin panel controls (no redeploy needed): which sections show,
 * Cuelinks channel + API key, Travelpayouts marker + search widgets, hidden categories/stores.
 * Stored in one SiteSetting document; env values are only the fallback defaults.
 */
const KEY = 'affiliate';
const STATUS_KEY = 'affiliate_status';

const defaults = () => ({
  sections: { offers: true, stores: true, travel: true },
  cuelinks: { cid: config.affiliate.cuelinksCid || '', apiKey: '', syncEnabled: true },
  travelpayouts: { marker: '', apiToken: '', flightsWidgetSrc: '', hotelsWidgetSrc: '', originCities: ['DEL', 'BOM', 'BLR', 'HYD', 'MAA', 'CCU'] },
  hiddenCategories: ['Credit Card', 'Finance'],
  hiddenDomains: ['mymuse.in'],
});

const merge = (base, over) => {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
  }
  return out;
};

// ---- cache: reads are hot (every outbound link), writes are rare ----
let cached = null;
let cachedAt = 0;
let loading = null;
const TTL = 30_000;

const load = async () => {
  try {
    const doc = await SiteSetting.findOne({ key: KEY }).lean();
    cached = merge(defaults(), doc?.value || {});
  } catch (err) {
    logger.warn('Settings load failed, using defaults', { error: err.message });
    cached = cached || defaults();
  }
  cachedAt = Date.now();
  return cached;
};

/** Current settings (async, fresh within 30s). */
const getAffiliateSettings = async () => {
  if (cached && Date.now() - cachedAt < TTL) return cached;
  if (!loading) loading = load().finally(() => (loading = null));
  return loading;
};

/** Synchronous snapshot for hot paths (link building); refreshes in the background. */
const peekAffiliateSettings = () => {
  if (!cached || Date.now() - cachedAt >= TTL) getAffiliateSettings().catch(() => {});
  return cached || defaults();
};

const cuelinksApiKey = (s) => s.cuelinks.apiKey || config.cuelinks.apiKey || '';
const travelpayoutsToken = (s) => s.travelpayouts.apiToken || config.travelpayouts.apiToken || '';

// ---- validation ----
const WIDGET_HOSTS = ['tp.media', 'travelpayouts.com', 'tpwgt.com', 'tpwdgt.com', 'tpembd.com', 'tpembars.com', 'tpscr.com'];

/** Accepts a widget URL or the whole <script …src="…"> snippet; returns a safe https src or ''. */
const cleanWidgetSrc = (input) => {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const src = (raw.match(/src\s*=\s*["']([^"']+)["']/i)?.[1] || raw).replace(/&amp;/g, '&');
  let u;
  try {
    u = new URL(src.startsWith('//') ? `https:${src}` : src);
  } catch {
    throw new AppError('Widget must be a Travelpayouts script URL or embed code', 400, 'INVALID_WIDGET');
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || !WIDGET_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    throw new AppError(`Widget scripts must come from Travelpayouts (${WIDGET_HOSTS.join(', ')})`, 400, 'INVALID_WIDGET');
  }
  return u.toString();
};

const cleanList = (v) =>
  (Array.isArray(v) ? v : String(v || '').split(','))
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 50);

const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

/** Apply an admin patch (only known fields). An empty apiKey keeps the stored one; null clears it. */
const updateAffiliateSettings = async (patch = {}, userId = null) => {
  const current = await getAffiliateSettings();
  const next = merge(defaults(), current);

  if (patch.sections) {
    for (const k of ['offers', 'stores', 'travel']) next.sections[k] = bool(patch.sections[k], next.sections[k]);
  }
  if (patch.cuelinks) {
    if (patch.cuelinks.cid !== undefined) {
      const cid = String(patch.cuelinks.cid || '').trim();
      if (cid && !/^\d{1,12}$/.test(cid)) throw new AppError('Cuelinks channel id must be numeric', 400, 'INVALID_CID');
      next.cuelinks.cid = cid;
    }
    if (patch.cuelinks.apiKey === null) next.cuelinks.apiKey = '';
    else if (typeof patch.cuelinks.apiKey === 'string' && patch.cuelinks.apiKey.trim()) next.cuelinks.apiKey = patch.cuelinks.apiKey.trim();
    next.cuelinks.syncEnabled = bool(patch.cuelinks.syncEnabled, next.cuelinks.syncEnabled);
  }
  if (patch.travelpayouts) {
    const tp = patch.travelpayouts;
    if (tp.marker !== undefined) {
      const marker = String(tp.marker || '').trim();
      if (marker && !/^[A-Za-z0-9_.-]{1,40}$/.test(marker)) throw new AppError('Marker should be your Travelpayouts partner id', 400, 'INVALID_MARKER');
      next.travelpayouts.marker = marker;
    }
    if (tp.apiToken === null) next.travelpayouts.apiToken = '';
    else if (typeof tp.apiToken === 'string' && tp.apiToken.trim()) {
      const token = tp.apiToken.trim();
      if (!/^[a-f0-9]{32}$/i.test(token)) throw new AppError('Travelpayouts API token is a 32-character code', 400, 'INVALID_TOKEN');
      next.travelpayouts.apiToken = token;
    }
    if (tp.originCities !== undefined) {
      const codes = cleanList(tp.originCities).map((c) => c.toUpperCase());
      const bad = codes.filter((c) => !/^[A-Z]{3}$/.test(c));
      if (bad.length) throw new AppError(`Use 3-letter airport/city codes (e.g. DEL, BOM): ${bad.join(', ')}`, 400, 'INVALID_CITY');
      next.travelpayouts.originCities = [...new Set(codes)].slice(0, 12);
    }
    if (tp.flightsWidgetSrc !== undefined) next.travelpayouts.flightsWidgetSrc = cleanWidgetSrc(tp.flightsWidgetSrc);
    if (tp.hotelsWidgetSrc !== undefined) next.travelpayouts.hotelsWidgetSrc = cleanWidgetSrc(tp.hotelsWidgetSrc);
  }
  if (patch.hiddenCategories !== undefined) next.hiddenCategories = cleanList(patch.hiddenCategories);
  if (patch.hiddenDomains !== undefined) next.hiddenDomains = cleanList(patch.hiddenDomains).map((d) => d.toLowerCase().replace(/^www\./, ''));

  await SiteSetting.createCollection().catch((e) => (e.codeName === 'NamespaceExists' ? null : Promise.reject(e)));
  await SiteSetting.updateOne({ key: KEY }, { $set: { value: next, updatedBy: userId } }, { upsert: true });
  cached = next;
  cachedAt = Date.now();
  return next;
};

/** Admin view: never returns the API key or token themselves. */
const adminView = (s) => {
  const key = cuelinksApiKey(s);
  const token = travelpayoutsToken(s);
  const { apiToken, ...tp } = s.travelpayouts;
  return {
    ...s,
    travelpayouts: {
      ...tp,
      hasApiToken: Boolean(token),
      apiTokenSource: apiToken ? 'admin' : config.travelpayouts.apiToken ? 'server' : null,
      apiTokenHint: token ? `••••${token.slice(-4)}` : '',
    },
    cuelinks: {
      cid: s.cuelinks.cid,
      syncEnabled: s.cuelinks.syncEnabled,
      hasApiKey: Boolean(key),
      apiKeySource: s.cuelinks.apiKey ? 'admin' : config.cuelinks.apiKey ? 'server' : null,
      apiKeyHint: key ? `••••${key.slice(-4)}` : '',
    },
  };
};

/** What the public website needs (no secrets). */
const publicConfig = (s) => ({
  sections: s.sections,
  cuelinksCid: s.cuelinks.cid,
  travel: {
    marker: s.travelpayouts.marker,
    flightsWidgetSrc: s.travelpayouts.flightsWidgetSrc,
    hotelsWidgetSrc: s.travelpayouts.hotelsWidgetSrc,
    originCities: s.travelpayouts.originCities,
    fares: Boolean(travelpayoutsToken(s)),
  },
});

// ---- last sync status ----
const recordSyncStatus = async (status) => {
  try {
    await SiteSetting.createCollection().catch((e) => (e.codeName === 'NamespaceExists' ? null : Promise.reject(e)));
    await SiteSetting.updateOne({ key: STATUS_KEY }, { $set: { value: { ...status, at: new Date() } } }, { upsert: true });
  } catch (err) {
    logger.warn('Could not record affiliate sync status', { error: err.message });
  }
};
const getSyncStatus = async () => (await SiteSetting.findOne({ key: STATUS_KEY }).lean().catch(() => null))?.value || null;

module.exports = {
  getAffiliateSettings,
  peekAffiliateSettings,
  updateAffiliateSettings,
  cuelinksApiKey,
  travelpayoutsToken,
  adminView,
  publicConfig,
  recordSyncStatus,
  getSyncStatus,
  cleanWidgetSrc,
};
