const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const config = require('./config');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Cluster mode: each worker keeps its own in-memory limiter, so split the budget
const workerShare = (n) => Math.max(1, Math.ceil(n / (parseInt(process.env.CLUSTER_WORKERS, 10) || 1)));

if (config.trustProxy) app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');

app.use(helmet());
app.use(
  cors({
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()),
    credentials: true,
  })
);

app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

if (config.env !== 'test') {
  app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));
}

if (config.rateLimit.enabled) {
  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: workerShare(config.rateLimit.max),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: 'Too many requests, please try again later',
      code: 'RATE_LIMIT',
    },
  });
  app.use(config.apiPrefix, limiter);
}

// Brute-force protection on credential endpoints — always on, independent of the global limiter
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: workerShare(config.env === 'production' ? 20 : 200),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: 'Too many login attempts, please try again later',
    code: 'RATE_LIMIT',
  },
});
app.use(`${config.apiPrefix}/auth/login`, authLimiter);
app.use(`${config.apiPrefix}/auth/register`, authLimiter);
app.use(`${config.apiPrefix}/auth/change-password`, authLimiter);

// Short shared caching for anonymous catalog reads; personalised/admin responses stay private
const PUBLIC_CACHE = /^\/(products|deals|brands)(\/|$)/;
app.use(config.apiPrefix, (req, res, next) => {
  if (req.method === 'GET' && !req.headers.authorization && PUBLIC_CACHE.test(req.path) && req.query.live === undefined) {
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    // Signed-in responses differ (isWatched/myAlert) — never reuse an anonymous copy for them
    res.vary('Authorization');
  } else {
    res.set('Cache-Control', 'no-store');
  }
  next();
});

app.use(config.apiPrefix, routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
