require('dotenv').config();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5000,
  apiPrefix: process.env.API_PREFIX || '/api/v1',
  mongodbUri:
    process.env.MONGODB_URI ||
    'mongodb+srv://pathak1160harsh_db_user:vi6Px4pEUvIYZHVG@cluster0.zlirzhv.mongodb.net/price_comparison?retryWrites=true&w=majority',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev_secret_change_me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  corsOrigin: process.env.CORS_ORIGIN || '*',
  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED === 'true',
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  },
  cron: {
    priceMonitor: process.env.PRICE_MONITOR_CRON || '0 * * * *',
    enabled: process.env.ENABLE_CRON !== 'false',
  },
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

module.exports = config;
