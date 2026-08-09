# Price Comparison Backend

Modular Node.js + Express + MongoDB backend for a Buyhatke-style price comparison platform, with a first-class **Scraper / Data Collection Engine**.

## Stack (V1)

- Node.js, Express, MongoDB, Mongoose, JWT
- node-cron (hourly price monitoring)
- Axios + Cheerio (HTTP HTML collection)
- Playwright (optional, JS-rendered pages only)
- Nodemailer + FCM abstractions

No Redis, BullMQ, Kafka, or microservices in V1.

## Quick start

```bash
cd backend
cp .env.example .env
npm install
npm run seed
npm run dev
```

Default scraper mode is `SCRAPER_MODE=demo` (local authorized demo feed — no live retailer scraping).

| Account | Email | Password |
|---------|-------|----------|
| Admin | admin@pricecompare.local | Admin@12345 |
| User | user@pricecompare.local | User@12345 |

## Scraper architecture

```
integrations/stores/
  base/          StoreAdapter, StoreParser, normalizer, validator, http/browser clients
  amazon/        adapter + scraper + parser + mapper
  flipkart/
  myntra/
  croma/
ScraperManager   resolves store slug → adapter
```

Collection preference order:

1. Official / affiliate / merchant API / feed (when credentials exist)
2. Demo feed (`SCRAPER_MODE=demo`)
3. Axios + Cheerio HTTP HTML
4. Playwright (only if `SCRAPER_ENABLE_PLAYWRIGHT=true`)

**Price safety:** failed scrapes never overwrite a valid `currentPrice` with null/0. They only update scrape health fields.

## Scraper test mode (real HTTP + Cheerio)

We do **not** bypass retailer anti-bot systems. For a proper local scrape pipeline test:

```bash
# Terminal A — fake storefront (HTML pages scrapers can fetch)
npm run fixtures

# Terminal B — API (SCRAPER_MODE=http in .env)
npm run seed
npm run scrape:test
npm run dev
```

Flow exercised: Axios GET → Cheerio parse → normalize/validate → Mongo price update → history/alerts.

Open a sample page: http://127.0.0.1:5055/amazon/p/AMZ-IP16-128

## Amazon first (recommended)

```bash
# Terminal A
npm run fixtures

# Terminal B — Amazon listings only
npm run scrape:amazon
```

### Live Amazon prices (Creators API)

Amazon’s HTML pages are protected; we do **not** scrape `amazon.in` with anti-bot bypasses.
Use the official **Creators API** (replaces deprecated PA-API 5):

1. Join [Amazon Associates (India)](https://affiliate-program.amazon.in/)
2. Associates Central → **Tools → Creators API** → create app + credential
3. Put values in `.env`:

```env
AMAZON_CREDENTIAL_ID=...
AMAZON_CREDENTIAL_SECRET=...
AMAZON_CREDENTIAL_VERSION=2.2
AMAZON_PARTNER_TAG=yourtag-21
AMAZON_MARKETPLACE=www.amazon.in
```

4. Seed / store products must use **real ASINs** (e.g. `B0XXXXXXXX`), not demo IDs like `AMZ-IP16-128`
5. Run `npm run scrape:amazon` — collection method will be `AFFILIATE_API`

## Live Flipkart prices (Playwright HTML — no affiliate)

Flipkart has no affiliate API in this project. Live prices use Playwright + Cheerio:

```env
SCRAPER_MODE=http
SCRAPER_ENABLE_PLAYWRIGHT=true
SCRAPER_TIMEOUT_MS=45000
```

```bash
npx playwright install chromium

# One product URL
npm run scrape:flipkart -- --url "https://www.flipkart.com/apple-iphone-16-pink-128-gb/p/itmc2e910b4d0b1c?pid=MOBH4DQFWJVDRSHM"

# Search
npm run scrape:flipkart -- --search "iphone 16" --limit 5

# Adapter smoke-test (default sample iPhone URL)
npm run scrape:flipkart
```

Store real `https://www.flipkart.com/...` URLs on `StoreProduct.productUrl` so price monitoring picks them up. Seed still writes fixture URLs for local `npm run fixtures` tests.

## Admin scraper APIs

- `GET  /api/v1/admin/scraper-health`
- `POST /api/v1/admin/scraper-health/retry`
- `POST /api/v1/admin/scraper-health/:storeProductId/retry`
- `POST /api/v1/admin/products/refresh`
- `POST /api/v1/admin/products/:productId/refresh`
