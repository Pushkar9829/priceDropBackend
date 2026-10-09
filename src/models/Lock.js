const mongoose = require('mongoose');

/**
 * Lease-based distributed lock. A holder owns `_id` until `expiresAt`; a crashed holder's
 * lease simply expires, so no manual cleanup is needed. Works across multiple instances.
 */
const lockSchema = new mongoose.Schema(
  {
    _id: { type: String },
    owner: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model('Lock', lockSchema);
