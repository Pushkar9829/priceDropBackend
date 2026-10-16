const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { AffiliateCampaign, AffiliateOffer } = require('../models');
const { escapeRegex } = require('../utils/regex');

/**
 * Cuelinks campaigns + offers → our database, and the read side for /offers and /stores.
 *
 * Only campaigns our channel can send traffic to (access open/approved) are shown, and
 * finance/credit-card and app-install campaigns are kept off the public pages: they need
 * product-specific disclosures we don't have yet.
 */
const INDIA = 252;
const HIDDEN_CATEGORIES = ['Credit Card', 'Finance'];
// Stores that don't fit a general family shopping site (adult products)
const HIDDEN_DOMAINS = ['mymuse.in'];
const isListedType = (type = '') => !/^CPI/i.test(type);

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'store';

const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const domainOf = (raw) => {
  if (raw?.url) {
    try {
      return new URL(raw.url).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      /* fall back to the API's domain field */
    }
  }
  return String(raw?.domain || '').toLowerCase();
};

const mapCampaign = (raw) => ({
  source: 'cuelinks',
  externalId: raw.id,
  name: String(raw.name || '').trim(),
  domain: domainOf(raw),
  url: raw.url || '',
  image: raw.image && !/Placeholder-Campaign/i.test(raw.image) ? raw.image : '',
  categories: (raw.categories || []).map((c) => c.name).filter(Boolean),
  campaignType: raw.campaign_type || '',
  payout: raw.payout != null ? String(raw.payout) : '',
  payoutCurrency: raw.payout_currency || '',
  accessStatus: raw.access_status || '',
  usable: ['open', 'approved'].includes(raw.access_status),
  deeplinkAllowed: Boolean(raw.deeplink_allowed),
  isFeatured: Boolean(raw.is_featured),
  epc7d: toNumber(raw.epc_7d),
  epc90d: toNumber(raw.epc_90d),
  cookieDuration: raw.cookie_duration || '',
  trackingUrl: raw.tracking_url || '',
});

const mapOffer = (raw) => ({
  source: 'cuelinks',
  externalId: raw.id,
  campaignExternalId: raw.campaign_id,
  storeName: raw.campaign_name || '',
  title: String(raw.title || '').trim(),
  description: String(raw.description || '')
    .replace(/\s+/g, ' ')
    .trim(),
  couponCode: raw.coupon_code || '',
  offerType: raw.offer_type || (raw.coupon_code ? 'coupon' : 'deal'),
  categories: (raw.categories || []).map((c) => c.name).filter(Boolean),
  trackingUrl: raw.tracking_url || '',
  startDate: toDate(raw.start_date),
  endDate: toDate(raw.end_date),
});

/**
 * Upsert campaigns and offers (raw Cuelinks V3 JSON). Offers are kept only for campaigns we
 * know; offers missing from a full sync, and expired ones, are removed.
 */
const importData = async ({ campaigns = [], offers = [], fullOfferSync = true } = {}) => {
  const now = new Date();
  await AffiliateCampaign.createCollection().catch((e) => (e.codeName === 'NamespaceExists' ? null : Promise.reject(e)));
  await AffiliateOffer.createCollection().catch((e) => (e.codeName === 'NamespaceExists' ? null : Promise.reject(e)));
  await Promise.all([AffiliateCampaign.createIndexes(), AffiliateOffer.createIndexes()]);

  // Stable, unique slugs: existing documents keep theirs; new ones take the name, or name-id on a clash
  const existing = await AffiliateCampaign.find({}, { externalId: 1, slug: 1 }).lean();
  const slugById = new Map(existing.map((c) => [c.externalId, c.slug]));
  const taken = new Set(existing.map((c) => c.slug));
  const campaignOps = [];
  for (const raw of campaigns) {
    if (!raw?.id || !raw?.name) continue;
    const doc = mapCampaign(raw);
    let slug = slugById.get(doc.externalId);
    if (!slug) {
      slug = slugify(doc.name);
      if (taken.has(slug)) slug = `${slug}-${doc.externalId}`;
      taken.add(slug);
      slugById.set(doc.externalId, slug);
    }
    campaignOps.push({
      updateOne: {
        filter: { source: 'cuelinks', externalId: doc.externalId },
        update: { $set: { ...doc, slug, syncedAt: now } },
        upsert: true,
      },
    });
  }
  for (let i = 0; i < campaignOps.length; i += 500) {
    await AffiliateCampaign.bulkWrite(campaignOps.slice(i, i + 500), { ordered: false });
  }

  const campaignDocs = await AffiliateCampaign.find({}, { externalId: 1, domain: 1, name: 1 }).lean();
  const byExternal = new Map(campaignDocs.map((c) => [c.externalId, c]));

  const offerOps = [];
  const seen = [];
  for (const raw of offers) {
    if (!raw?.id || !raw?.tracking_url || !raw?.title) continue;
    const doc = mapOffer(raw);
    const campaign = byExternal.get(doc.campaignExternalId);
    if (!campaign) continue;
    if (doc.endDate && doc.endDate < now) continue;
    seen.push(doc.externalId);
    offerOps.push({
      updateOne: {
        filter: { source: 'cuelinks', externalId: doc.externalId },
        update: { $set: { ...doc, campaign: campaign._id, domain: campaign.domain, storeName: doc.storeName || campaign.name, syncedAt: now } },
        upsert: true,
      },
    });
  }
  for (let i = 0; i < offerOps.length; i += 500) {
    await AffiliateOffer.bulkWrite(offerOps.slice(i, i + 500), { ordered: false });
  }

  const removed = await AffiliateOffer.deleteMany({
    $or: [{ endDate: { $lt: now } }, ...(fullOfferSync ? [{ externalId: { $nin: seen } }] : [])],
  });

  // Cache each store's live offer count for the directory
  const counts = await AffiliateOffer.aggregate([{ $group: { _id: '$campaign', n: { $sum: 1 } } }]);
  await AffiliateCampaign.updateMany({}, { $set: { offerCount: 0 } });
  if (counts.length) {
    await AffiliateCampaign.bulkWrite(
      counts.filter((c) => c._id).map((c) => ({ updateOne: { filter: { _id: c._id }, update: { $set: { offerCount: c.n } } } })),
      { ordered: false }
    );
  }

  const summary = { campaigns: campaignOps.length, offers: offerOps.length, offersRemoved: removed.deletedCount };
  logger.info('Affiliate catalog imported', summary);
  return summary;
};

// ---------- Cuelinks V3 API ----------

const api = () => {
  if (!config.cuelinks.apiKey) {
    throw new AppError('CUELINKS_API_KEY is not set', 400, 'CUELINKS_NOT_CONFIGURED');
  }
  return axios.create({
    baseURL: config.cuelinks.baseUrl,
    timeout: 30_000,
    headers: { Authorization: `Token ${config.cuelinks.apiKey}`, Accept: 'application/json' },
  });
};

/** Page through a V3 list endpoint (`key` = campaigns | offers). */
const fetchAll = async (client, path, key, params = {}, maxPages = 20) => {
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const { data } = await client.get(path, { params: { ...params, page, per_page: 500 } });
    const batch = data?.[key] || data?.data || [];
    items.push(...batch);
    if (!data?.meta?.next_page || !batch.length) break;
  }
  return items;
};

/** Full refresh from the Cuelinks API (daily job / admin button). */
const syncFromApi = async () => {
  const client = api();
  const campaigns = await fetchAll(client, '/campaigns', 'campaigns', { country_id: INDIA });
  const usableIds = new Set(campaigns.filter((c) => ['open', 'approved'].includes(c.access_status)).map((c) => c.id));
  const offers = (await fetchAll(client, '/offers', 'offers')).filter((o) => usableIds.has(o.campaign_id));
  return importData({ campaigns, offers });
};

// ---------- Read side ----------

const listedCampaignFilter = () => ({
  usable: true,
  categories: { $nin: HIDDEN_CATEGORIES },
  campaignType: { $not: /^CPI/i },
  domain: { $nin: HIDDEN_DOMAINS },
});

const pageOf = (page, limit, max = 60) => {
  const l = Math.min(max, Math.max(1, parseInt(limit, 10) || 24));
  const p = Math.min(200, Math.max(1, parseInt(page, 10) || 1));
  return { page: p, limit: l, skip: (p - 1) * l };
};

const publicCampaign = (c) => ({
  id: c._id,
  slug: c.slug,
  name: c.name,
  domain: c.domain,
  image: c.image,
  categories: c.categories,
  offerCount: c.offerCount || 0,
  isFeatured: c.isFeatured,
  shopUrl: c.trackingUrl,
});

const publicOffer = (o) => ({
  id: o._id,
  title: o.title,
  description: o.description,
  couponCode: o.couponCode,
  offerType: o.offerType,
  categories: o.categories,
  url: o.trackingUrl,
  endDate: o.endDate,
  store: o.campaign
    ? { slug: o.campaign.slug, name: o.campaign.name, image: o.campaign.image, domain: o.campaign.domain }
    : { name: o.storeName, domain: o.domain },
});

const listedCampaignIds = async (extra = {}) =>
  (await AffiliateCampaign.find({ ...listedCampaignFilter(), ...extra }, { _id: 1 }).lean()).map((c) => c._id);

const listOffers = async ({ category, store, q, type, page, limit } = {}) => {
  const { page: p, limit: l, skip } = pageOf(page, limit);
  const campaignExtra = {};
  if (store) campaignExtra.slug = String(store);
  const ids = await listedCampaignIds(campaignExtra);
  const filter = { campaign: { $in: ids }, $or: [{ endDate: null }, { endDate: { $gte: new Date() } }] };
  if (category) filter.categories = String(category);
  if (type === 'coupon') filter.couponCode = { $ne: '' };
  if (q) filter.$and = [{ $or: [{ title: { $regex: escapeRegex(String(q)), $options: 'i' } }, { storeName: { $regex: escapeRegex(String(q)), $options: 'i' } }] }];
  const [items, total] = await Promise.all([
    AffiliateOffer.find(filter).sort({ createdAt: -1 }).skip(skip).limit(l).populate('campaign', 'slug name image domain').lean(),
    AffiliateOffer.countDocuments(filter),
  ]);
  return { items: items.map(publicOffer), total, page: p, pages: Math.max(1, Math.ceil(total / l)) };
};

const listStores = async ({ category, q, page, limit } = {}) => {
  const { page: p, limit: l, skip } = pageOf(page, limit, 96);
  const filter = listedCampaignFilter();
  if (category) filter.categories = { $in: [String(category)], $nin: HIDDEN_CATEGORIES };
  if (q) filter.name = { $regex: escapeRegex(String(q)), $options: 'i' };
  const [items, total, categories] = await Promise.all([
    AffiliateCampaign.find(filter).sort({ isFeatured: -1, offerCount: -1, epc90d: -1, name: 1 }).skip(skip).limit(l).lean(),
    AffiliateCampaign.countDocuments(filter),
    AffiliateCampaign.aggregate([
      { $match: listedCampaignFilter() },
      { $unwind: '$categories' },
      { $match: { categories: { $nin: HIDDEN_CATEGORIES } } },
      { $group: { _id: '$categories', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);
  return {
    items: items.map(publicCampaign),
    total,
    page: p,
    pages: Math.max(1, Math.ceil(total / l)),
    categories: categories.map((c) => ({ name: c._id, count: c.count })),
  };
};

const getStore = async (slug) => {
  const c = await AffiliateCampaign.findOne({ ...listedCampaignFilter(), slug: String(slug) }).lean();
  if (!c) throw new AppError('Store not found', 404, 'NOT_FOUND');
  const offers = await AffiliateOffer.find({ campaign: c._id, $or: [{ endDate: null }, { endDate: { $gte: new Date() } }] })
    .sort({ createdAt: -1 })
    .limit(60)
    .lean();
  return { store: publicCampaign(c), offers: offers.map((o) => publicOffer({ ...o, campaign: c })) };
};

/** Live offers for a store website (product page "Offers from this store"). */
const offersForDomain = async (domain, limit = 6) => {
  const d = String(domain || '').toLowerCase().replace(/^www\./, '');
  if (!d) return [];
  const ids = await listedCampaignIds({ domain: d });
  if (!ids.length) return [];
  const offers = await AffiliateOffer.find({ campaign: { $in: ids }, $or: [{ endDate: null }, { endDate: { $gte: new Date() } }] })
    .sort({ createdAt: -1 })
    .limit(Math.min(12, limit))
    .populate('campaign', 'slug name image domain')
    .lean();
  return offers.map(publicOffer);
};

module.exports = { importData, syncFromApi, listOffers, listStores, getStore, offersForDomain, isListedType, HIDDEN_CATEGORIES };
