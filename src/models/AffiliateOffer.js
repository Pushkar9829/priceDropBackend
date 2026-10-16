const mongoose = require('mongoose');

/** A live coupon or deal from an affiliate campaign (Cuelinks offers feed). */
const affiliateOfferSchema = new mongoose.Schema(
  {
    source: { type: String, default: 'cuelinks' },
    externalId: { type: Number, required: true },
    campaignExternalId: { type: Number, required: true },
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateCampaign', index: true },
    storeName: { type: String, default: '' },
    domain: { type: String, default: '', lowercase: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    couponCode: { type: String, default: '' },
    offerType: { type: String, default: 'deal' }, // deal | coupon
    categories: [{ type: String }],
    trackingUrl: { type: String, required: true },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    syncedAt: { type: Date, default: Date.now },
  },
  // Collections + indexes are created by the importer (cuelinksService.importData), not at
  // app start: a cluster at its collection limit must not break startup — reads just return empty.
  { timestamps: true, autoCreate: false, autoIndex: false }
);

affiliateOfferSchema.index({ source: 1, externalId: 1 }, { unique: true });
affiliateOfferSchema.index({ endDate: 1 });
affiliateOfferSchema.index({ domain: 1, endDate: 1 });
affiliateOfferSchema.index({ categories: 1, createdAt: -1 });
affiliateOfferSchema.index({ title: 'text', storeName: 'text', description: 'text' });

module.exports = mongoose.model('AffiliateOffer', affiliateOfferSchema);
