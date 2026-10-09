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

Frontend (shopper site + admin console in one app) lives in `../frontend` — see its README.

## API changes (v2)

- `GET /products/search` — new `sort` (`relevance` | `price_asc` | `price_desc` | `newest`), `category`, `brand` params; `live=1` is admin-only
- `GET /products/categories` — categories with counts
- `GET /products/:id` — includes `isWatched` when a token is sent
- `PATCH /auth/me`, `POST /auth/change-password` (changing the password revokes older tokens)
- `GET /notifications/unread-count`, `PATCH /notifications/read-all`; the user inbox lists in-app notifications only
- Admin: `PATCH /admin/users/:id`, `PATCH /admin/products/:id`; keyword scrape, full refresh and batch retry now return
  `202 { job }` — poll `GET /admin/jobs/:id`

## Running in production / concurrency

`npm start` runs `src/cluster.js`: one API process per CPU core (`WEB_CONCURRENCY` to override). Exactly one
process runs background jobs (price monitor); admin jobs are stored in MongoDB so any process can serve them.
Anonymous catalog reads (search, deals, stores, similar) are cached in-process for 30–120 s.

Load test (10k products, mixed anonymous + signed-in traffic, laptop with API + MongoDB + load generator on 4 cores):
200 simultaneous users → median 9 ms, p95 149 ms, 0 errors. Size the server by CPU cores; MongoDB stayed <5% CPU.

## Live price monitoring

The cron (`PRICE_MONITOR_CRON`, default every 5 min) is only a **tick**. Each listing carries its own
`nextCheckAt`; a tick checks the most overdue listings (up to `MONITOR_BATCH_SIZE`) and reschedules each one:

| Tier | When | Re-check every |
|------|------|----------------|
| HOT | product has an active alert or is on a watchlist | 30 min |
| NORMAL | visible product, nobody tracking it | 2 h |
| COLD | product hidden by an admin | 12 h |

- **Failures back off** exponentially (×2 per consecutive failure, max 24 h). A failed check never overwrites a price.
- **Demand pulls work forward**: watching or setting an alert moves a product to HOT immediately; opening a
  product page whose prices are older than 30 min queues it for the next tick (the page polls and updates itself).
- **One run at a time across instances** via a MongoDB lease lock (`locks` collection) that expires on its own if a run crashes.
- Stores are checked **in parallel**, with limited concurrency and a polite delay per store. Disabled stores are skipped.
- On every price/stock change: price history → listing all-time low/high → deal created/updated/ended →
  product `priceSummary` recomputed → alerts evaluated (store-specific alerts use that store's price, "any store"
  alerts use the product's lowest in-stock price).
- **Sleeping hosts** (Render free tier) never fire the in-process cron. Set `CRON_SECRET` and call
  `POST /api/v1/internal/monitor/tick` with header `x-cron-secret` every 5 min from cron-job.org / GitHub Actions / Render Cron Jobs.
- Admin → Dashboard shows the live monitor (queue, tiers, current/last run, latest price moves) and can run a tick on demand.

**Fast reads:** every product stores a denormalized `priceSummary` (lowest/highest price, MRP, discount, store
counts, best listing). Search, price sorting, brand sections and admin lists read it through indexes instead of
aggregating listings per request. After upgrading an existing database run `npm run backfill:monitoring` once
(the server also backfills missing summaries on startup).

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
