const mongoose = require('mongoose');

/** Admin-editable site settings, one document per key (e.g. "affiliate"). */
const siteSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  // Created on first save (not at startup) so a cluster at its collection cap still boots
  { timestamps: true, autoCreate: false, autoIndex: false, minimize: false }
);

module.exports = mongoose.model('SiteSetting', siteSettingSchema);
