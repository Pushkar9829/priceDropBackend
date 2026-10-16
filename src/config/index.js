require('dotenv').config();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5000,
  apiPrefix: process.env.API_PREFIX || '/api/v1',
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/price_comparison',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev_secret_change_me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  corsOrigin: process.env.CORS_ORIGIN || '*',
  // Public site address — used in the sitemap and in links sent by email
  siteUrl: (process.env.SITE_URL || 'https://www.droppingnow.com').replace(/\/+$/, ''),
  affiliate: {
    // Cuelinks channel id; outbound store links are wrapped in its tracking redirect
    cuelinksCid: process.env.CUELINKS_CID === undefined ? '279120' : process.env.CUELINKS_CID,
  },
  cuelinks: {
    // V3 API key (cuelinks.com → Settings → API Keys, scopes read:campaigns + read:offers)
    apiKey: process.env.CUELINKS_API_KEY || '',
    baseUrl: process.env.CUELINKS_API_BASE || 'https://developers.cuelinks.com/pub_api/v3',
    // Daily refresh of stores + coupons (runs only when the API key is set)
    syncCron: process.env.CUELINKS_SYNC_CRON || '30 3 * * *',
  },
  /** Number of reverse proxies in front of the app (Render/Heroku = 1). */
  trustProxy: parseInt(process.env.TRUST_PROXY, 10) || 0,
  rateLimit: {
    // On by default; per-IP budget sized for normal browsing incl. product-page polling
    enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 600,
  },
  cron: {
    // Scheduler tick — each tick checks only listings whose nextCheckAt is due
    priceMonitor: process.env.PRICE_MONITOR_CRON || '*/5 * * * *',
    enabled: process.env.ENABLE_CRON !== 'false',
  },
  /** Adaptive live-price monitoring (see services/monitorScheduler.js). */
  monitor: {
    hotIntervalMin: parseInt(process.env.MONITOR_HOT_INTERVAL_MIN, 10) || 30,
    normalIntervalMin: parseInt(process.env.MONITOR_NORMAL_INTERVAL_MIN, 10) || 240,
    coldIntervalMin: parseInt(process.env.MONITOR_COLD_INTERVAL_MIN, 10) || 720,
    maxBackoffMin: parseInt(process.env.MONITOR_MAX_BACKOFF_MIN, 10) || 24 * 60,
    batchSize: parseInt(process.env.MONITOR_BATCH_SIZE, 10) || 150,
    /** Stop picking new listings after this long so ticks never overlap. */
    tickBudgetMs: (parseInt(process.env.MONITOR_TICK_BUDGET_SEC, 10) || 240) * 1000,
    /** Parallel checks per store (stores themselves run in parallel). */
    perStoreConcurrency: parseInt(process.env.MONITOR_PER_STORE_CONCURRENCY, 10) || 2,
    /** Polite pause between requests to the same store. */
    perStoreDelayMs: parseInt(process.env.MONITOR_PER_STORE_DELAY_MS, 10) || 1500,
    /** A product view re-queues listings older than this. */
    staleOnViewMin: parseInt(process.env.MONITOR_STALE_ON_VIEW_MIN, 10) || 30,
    dealTtlDays: 7,
  },
  /** Shared secret for POST /internal/monitor/tick (external cron when the host sleeps). */
  cronSecret: process.env.CRON_SECRET || '',
  email: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.EMAIL_FROM || 'noreply@pricecompare.local',
  },
  fcm: {
    serverKey: process.env.FCM_SERVER_KEY || '',
  },
  matching: {
    minConfidenceToMerge: 0.85,
  },
  priceDrop: {
    significantPercent: 5,
    majorPercent: 10,
  },
  scraper: {
    /**
     * demo  — in-memory demo feed (no HTTP)
     * http  — Axios + Cheerio against productUrl (use fixture server for local tests)
     * auto  — API/feed → demo → http → playwright
     */
    mode: process.env.SCRAPER_MODE || 'demo',
    timeoutMs: parseInt(process.env.SCRAPER_TIMEOUT_MS, 10) || 15000,
    maxRetries: parseInt(process.env.SCRAPER_MAX_RETRIES, 10) || 2,
    concurrency: parseInt(process.env.SCRAPER_CONCURRENCY, 10) || 3,
    enablePlaywright: process.env.SCRAPER_ENABLE_PLAYWRIGHT === 'true',
    fixtureBase:
      process.env.SCRAPER_FIXTURE_BASE ||
      `http://${process.env.SCRAPER_FIXTURE_HOST || '127.0.0.1'}:${process.env.SCRAPER_FIXTURE_PORT || 5055}`,
    userAgent:
      process.env.SCRAPER_USER_AGENT ||
      'PriceCompareBot/1.0 (+https://pricecompare.local; permitted-data-collection)',
  },
  /**
   * Amazon Creators API (official). Required for live Amazon prices.
   * Get credentials: Associates Central → Tools → Creators API.
   * India marketplace uses credential version 2.2 or 3.2 typically.
   */
  amazon: {
    credentialId: process.env.AMAZON_CREDENTIAL_ID || '',
    credentialSecret: process.env.AMAZON_CREDENTIAL_SECRET || '',
    credentialVersion: process.env.AMAZON_CREDENTIAL_VERSION || '2.2',
    partnerTag: process.env.AMAZON_PARTNER_TAG || '',
    marketplace: process.env.AMAZON_MARKETPLACE || 'www.amazon.in',
  },
};

const isWeakSecret = (s) => !s || s === 'dev_secret_change_me' || s.startsWith('change_this') || s.length < 32;

/**
 * Fail fast on unsafe production configuration.
 * Returns { problems } that stop startup and { warnings } that are only logged.
 */
config.validate = () => {
  const problems = [];
  const warnings = [];
  if (config.env === 'production') {
    if (!process.env.MONGODB_URI) problems.push('MONGODB_URI is required in production');
    if (isWeakSecret(process.env.JWT_SECRET)) {
      problems.push('JWT_SECRET must be set to a random string of at least 32 characters');
    }
    if (config.scraper.mode === 'demo') {
      // Demo mode random-walks prices → fake price drops, deals and alert emails
      problems.push('SCRAPER_MODE must be http or auto in production (demo generates fake prices)');
    }
    if (!process.env.CORS_ORIGIN || config.corsOrigin.trim() === '*') {
      problems.push('CORS_ORIGIN must list the frontend origin(s) in production, not *');
    }
    if (process.env.TRUST_PROXY === undefined) {
      // Behind a proxy every client shares one IP → one user can lock out all logins
      problems.push('TRUST_PROXY must be set (1 behind Render/Heroku/Nginx, 0 if exposed directly)');
    }
    if (!config.email.host || !config.email.user || !config.email.pass) {
      warnings.push('SMTP_HOST/SMTP_USER/SMTP_PASS not set — alert emails are disabled (in-app notifications still work)');
    }
    if (!config.cronSecret) {
      warnings.push('CRON_SECRET not set — external monitor ticks are disabled (fine if the host never sleeps)');
    }
  }
  return { problems, warnings };
};

module.exports = config;
