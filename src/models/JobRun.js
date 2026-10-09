const mongoose = require('mongoose');

/** Admin background job (keyword scrape, full refresh, retry batch) — shared by all API processes. */
const jobRunSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, index: true },
    label: { type: String, default: '' },
    status: { type: String, enum: ['running', 'completed', 'failed'], default: 'running', index: true },
    progress: { type: mongoose.Schema.Types.Mixed, default: null },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    owner: { type: String, default: '' },
    heartbeatAt: { type: Date, default: Date.now },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

jobRunSchema.index({ createdAt: -1 });
// Old job records clean themselves up after 14 days
jobRunSchema.index({ finishedAt: 1 }, { expireAfterSeconds: 14 * 24 * 3600 });

module.exports = mongoose.model('JobRun', jobRunSchema);
