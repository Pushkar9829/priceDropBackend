/**
 * Local permitted storefront fixture server.
 *
 * Serves store-like HTML so Axios + Cheerio scrapers can be tested
 * end-to-end WITHOUT hitting live retailer sites or bypassing protections.
 *
 * Routes:
 *   GET /health
 *   GET /:store/p/:externalId   — product page HTML
 *   GET /:store/search?q=       — search results HTML (basic)
 */
require('dotenv').config();

const http = require('http');
const { URL } = require('url');
const { findByExternalId, catalog, jitterPrice } = require('../demo/demoCatalog');
const logger = require('../../utils/logger');

const PORT = parseInt(process.env.SCRAPER_FIXTURE_PORT, 10) || 5055;
const HOST = process.env.SCRAPER_FIXTURE_HOST || '127.0.0.1';

const renderAmazon = (data, price) => `<!DOCTYPE html>
<html><head><title>${data.title}</title></head><body>
  <span id="productTitle">${data.title}</span>
  <span class="a-price"><span class="a-offscreen">₹${price}</span><span class="a-price-whole">${price}</span></span>
  <div id="priceblock_ourprice">₹${price}</div>
  <div id="availability"><span>In Stock</span></div>
  <div id="bylineInfo">Brand: ${data.brand || ''}</div>
  <img id="landingImage" src="${(data.images && data.images[0]) || ''}" />
  <a id="sellerProfileTriggerId">${data.seller || 'Amazon'}</a>
</body></html>`;

const renderFlipkart = (data, price) => `<!DOCTYPE html>
<html><head><title>${data.title}</title></head><body>
  <h1 class="yhB1nd"><span class="B_NuCI">${data.title}</span></h1>
  <div class="Nx9bqj">${price}</div>
  <div class="_30jeq3">₹${price}</div>
  <div class="availability">In Stock</div>
  <div data-brand="${data.brand || ''}"></div>
  <img class="_396cs4" src="${(data.images && data.images[0]) || ''}" />
</body></html>`;

const renderMyntra = (data, price) => `<!DOCTYPE html>
<html><head><title>${data.title}</title></head><body>
  <h1 class="pdp-name">${data.title}</h1>
  <span class="pdp-price">₹${price}</span>
  <div class="availability">In Stock</div>
  <div data-brand="${data.brand || ''}"></div>
  <img id="landingImage" src="${(data.images && data.images[0]) || ''}" />
</body></html>`;

const renderCroma = (data, price) => `<!DOCTYPE html>
<html><head><title>${data.title}</title></head><body>
  <h1 class="pdp-title">${data.title}</h1>
  <div class="new-price">${price}</div>
  <div class="pdp-price">₹${price}</div>
  <div class="availability">In Stock</div>
  <div data-brand="${data.brand || ''}"></div>
  <img id="landingImage" src="${(data.images && data.images[0]) || ''}" />
</body></html>`;

const RENDERERS = {
  amazon: renderAmazon,
  flipkart: renderFlipkart,
  myntra: renderMyntra,
  croma: renderCroma,
};

const buildProductHtml = (store, externalId) => {
  const found = findByExternalId(store, externalId);
  if (!found) return null;

  const { item, storeEntry } = found;
  // Force a price move often so monitoring can detect changes during tests
  const forceJitter = Math.random() > 0.15;
  let price = storeEntry.basePrice;
  if (forceJitter) {
    price = jitterPrice(storeEntry.externalId, storeEntry.basePrice);
    // Extra nudge so consecutive scrapes differ more often
    if (Math.random() > 0.4) {
      const bump = Math.round(price * (0.01 + Math.random() * 0.03)) * (Math.random() > 0.5 ? -1 : 1);
      price = Math.max(100, price + bump);
    }
  } else {
    price = jitterPrice(storeEntry.externalId, storeEntry.basePrice);
  }

  const data = {
    title: storeEntry.title,
    brand: item.brand,
    seller: storeEntry.seller,
    images: item.images,
  };

  const render = RENDERERS[store] || renderAmazon;
  return {
    html: render(data, price),
    price,
    title: storeEntry.title,
  };
};

const buildSearchHtml = (store, query) => {
  const q = (query || '').toLowerCase();
  const rows = [];

  for (const item of catalog) {
    const entry = item.stores[store];
    if (!entry) continue;
    const hay = `${item.title} ${item.brand}`.toLowerCase();
    if (!q || hay.includes(q)) {
      const price = jitterPrice(entry.externalId, entry.basePrice);
      rows.push(`
        <div data-component-type="s-search-result" data-asin="${entry.externalId}" data-id="${entry.externalId}">
          <h2><a href="/${store}/p/${entry.externalId}"><span>${entry.title}</span></a></h2>
          <span class="a-price"><span class="a-offscreen">₹${price}</span><span class="a-price-whole">${price}</span></span>
          <a class="s1Q9rs" title="${entry.title}" href="/${store}/p/${entry.externalId}">${entry.title}</a>
        </div>
      `);
    }
  }

  return `<!DOCTYPE html><html><body>${rows.join('\n') || '<p>No results</p>'}</body></html>`;
};

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, mode: 'fixture-storefront' }));
      return;
    }

    const productMatch = url.pathname.match(/^\/(amazon|flipkart|myntra|croma)\/p\/([^/]+)\/?$/);
    if (productMatch) {
      const [, store, externalId] = productMatch;
      const page = buildProductHtml(store, decodeURIComponent(externalId));
      if (!page) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Product not found');
        return;
      }
      logger.debug('Fixture product served', { store, externalId, price: page.price });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page.html);
      return;
    }

    const searchMatch = url.pathname.match(/^\/(amazon|flipkart|myntra|croma)\/search\/?$/);
    if (searchMatch) {
      const store = searchMatch[1];
      const html = buildSearchHtml(store, url.searchParams.get('q') || '');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found. Try /amazon/p/AMZ-IP16-128');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(err.message);
  }
});

server.listen(PORT, HOST, () => {
  logger.info('Fixture storefront listening', {
    base: `http://${HOST}:${PORT}`,
    example: `http://${HOST}:${PORT}/amazon/p/AMZ-IP16-128`,
  });
});
