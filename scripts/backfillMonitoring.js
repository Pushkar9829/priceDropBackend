/**
 * Backfill listing price extremes + product price summaries (run once after upgrading).
 * Usage: node scripts/backfillMonitoring.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const { backfillMonitoringData } = require('../src/utils/monitoringBackfill');

(async () => {
  await connectDB();
  const result = await backfillMonitoringData();
  console.log('Backfill complete', result);
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
