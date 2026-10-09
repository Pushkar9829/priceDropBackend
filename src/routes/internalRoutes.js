const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

/**
 * External scheduler hook. Hosts that sleep when idle (e.g. Render free tier) never fire the
 * in-process cron — point an external cron (cron-job.org, GitHub Actions, Render Cron Job) at:
 *   POST /api/v1/internal/monitor/tick   with header  x-cron-secret: $CRON_SECRET
 * The call returns immediately; the run continues in the background.
 */
const requireCronSecret = (req, res, next) => {
  const given = Buffer.from(String(req.get('x-cron-secret') || ''));
  const expected = Buffer.from(config.cronSecret);
  if (!config.cronSecret || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return next(new AppError('Forbidden', 403, 'FORBIDDEN'));
  }
  return next();
};

router.post(
  '/monitor/tick',
  requireCronSecret,
  asyncHandler(async (req, res) => {
    const { tick } = require('../jobs');
    tick();
    res.status(202).json({ success: true, message: 'Monitor tick started' });
  })
);

module.exports = router;
