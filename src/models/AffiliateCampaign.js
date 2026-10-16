const mongoose = require('mongoose');

/**
 * A Cuelinks advertiser campaign (a store we can earn from). Synced from the Cuelinks
 * V3 API; `usable` = our channel may send traffic now (access open or approved).
 */
const affiliateCampaignSchema = new mongoose.Schema(
  {
    source: { type: String, default: 'cuelinks' },
    externalId: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true },
    domain: { type: String, default: '', lowercase: true, trim: true },
    url: { type: String, default: '' },
    image: { type: String, default: '' },
    categories: [{ type: String }],
    campaignType: { type: String, default: '' }, // CPS | CPC | CPL | CPI …
    payout: { type: String, default: '' },
    payoutCurrency: { type: String, default: '' },
    accessStatus: { type: String, default: '' },
    usable: { type: Boolean, default: false },
    deeplinkAllowed: { type: Boolean, default: false },
    isFeatured: { type: Boolean, default: false },
    epc7d: { type: Number, default: 0 },
    epc90d: { type: Number, default: 0 },
    cookieDuration: { type: String, default: '' },
    trackingUrl: { type: String, default: '' },
    offerCount: { type: Number, default: 0 },
    // Admin overrides — the sync never touches these
    adminHidden: { type: Boolean, default: false },
    adminFeatured: { type: Boolean, default: false },
    syncedAt: { type: Date, default: Date.now },
  },
  // Collections + indexes are created by the importer (cuelinksService.importData), not at
  // app start: a cluster at its collection limit must not break startup — reads just return empty.
  { timestamps: true, autoCreate: false, autoIndex: false }
);

affiliateCampaignSchema.index({ source: 1, externalId: 1 }, { unique: true });
affiliateCampaignSchema.index({ slug: 1 }, { unique: true });
affiliateCampaignSchema.index({ usable: 1, epc90d: -1 });
affiliateCampaignSchema.index({ domain: 1 });

module.exports = mongoose.model('AffiliateCampaign', affiliateCampaignSchema);
