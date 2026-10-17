const { parsePrice } = require('../base/normalizer');
const StoreParser = require('../base/StoreParser');
const { CollectionError, FETCH_ERRORS } = require('../base/store.types');

/**
 * Amazon HTML parser (Cheerio) — fixtures + live amazon.in.
 */
// Price blocks of the main buy box, most specific first (other .a-price nodes on the page
// belong to EMI plans, other sellers, accessories and recommendations)
const CORE_PRICE_BOXES = [
  '#corePriceDisplay_desktop_feature_div',
  '#corePrice_feature_div',
  '#corePrice_desktop',
  '#apex_desktop',
  '#apex_offerDisplay_desktop',
];
// Unit prices ("₹2,09,900.00 per g") live next to the real price — never a price or an MRP
const UNIT_PRICE = '.pricePerUnit, [id*="pricePerUnit"], [id*="PricePerUnit"], [id*="TaxInclusiveMessage"]';

/**
 * Some amazon.in nodes print amounts without the decimal point ("₹18,49900" is ₹18,499.00),
 * mixed with normal ones on the same page. amazon.in always groups thousands with commas,
 * so 5 digits after the last comma — or 4+ digits with no comma at all — means paise glued on.
 */
const moneyText = (raw) => {
  let s = String(raw || '').replace(/\s+/g, '');
  const digits = s.replace(/^₹/, '');
  if (/^\d{1,3}(,\d{2,3})*,\d{5}$/.test(digits) || /^\d{4,}$/.test(digits)) s = s.slice(0, -2);
  return parsePrice(s);
};

class AmazonParser extends StoreParser {
  /** Selling price from the buy box: the whole-rupee part when present, else the a11y text. */
  corePrice($, html) {
    for (const box of CORE_PRICE_BOXES) {
      const nodes = $(`${box} .a-price`).toArray();
      for (const node of nodes) {
        const $p = $(node);
        // Struck-through list prices and unit prices are not the selling price
        if ($p.hasClass('a-text-price') || $p.attr('data-a-strike') === 'true' || $p.closest(UNIT_PRICE).length) continue;
        const whole = parsePrice($p.find('.a-price-whole').first().text());
        const price = whole || moneyText($p.find('.a-offscreen').first().text());
        if (price) return price;
      }
    }
    return null;
  }

  /** M.R.P. / list price shown struck-through in the buy box (never a per-unit price). */
  listPrice($, html) {
    const selectors = [
      ...CORE_PRICE_BOXES.map((b) => `${b} .basisPrice .a-offscreen`),
      ...CORE_PRICE_BOXES.map((b) => `${b} .a-text-price .a-offscreen`),
      '#listPrice',
      '.basisPrice .a-offscreen',
    ];
    for (const selector of selectors) {
      for (const node of $(selector).toArray()) {
        const $n = $(node);
        if ($n.closest(UNIT_PRICE).length || /\bper\s/i.test($n.parent().parent().text())) continue;
        const value = moneyText($n.text() || $n.attr('content'));
        if (value) return value;
      }
    }
    return null;
  }


  extractAsinFromUrl(url = '') {
    try {
      const u = new URL(url);
      const dp = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
      if (dp?.[1]) return dp[1].toUpperCase();
      const asin = u.searchParams.get('asin');
      return asin ? asin.toUpperCase() : null;
    } catch {
      return null;
    }
  }

  parseProductPage(html, url = '') {
    const $ = this.load(html);

    const title =
      this.text($, '#productTitle') ||
      this.text($, '#title') ||
      this.text($, 'h1.product-title') ||
      this.text($, 'h1 span') ||
      this.text($, 'h1');

    const price =
      this.corePrice($, html) ??
      this.priceFromSelectors($, ['#priceblock_ourprice', '#priceblock_dealprice', '.a-price-whole', '.price']);

    const mrp = this.listPrice($, html);

    const availabilityText =
      this.text($, '#availability') ||
      this.text($, '#availability span') ||
      this.text($, '.availability');

    const brand =
      this.attr($, '[data-brand]', 'data-brand') ||
      this.text($, '#bylineInfo') ||
      '';

    const image =
      this.attr($, '#landingImage', 'src') ||
      this.attr($, '#imgTagWrapperId img', 'src') ||
      this.attr($, '#landingImage', 'data-old-hires') ||
      '';

    if (!title) {
      if (/Looking for something\?|couldn.t find that page|Page Not Found/i.test($('title').text() + $('body').text().slice(0, 3000))) {
        throw new CollectionError('Amazon: product page removed', FETCH_ERRORS.PRODUCT_NOT_FOUND);
      }
      throw new CollectionError('Amazon parser: title missing', FETCH_ERRORS.PARSE_FAILURE);
    }

    return {
      title,
      currentPrice: price,
      mrp,
      availability: this.availabilityFromText(availabilityText || 'IN_STOCK'),
      brand: brand.replace(/^Visit the |^Brand:\s*/i, '').replace(/Store$/i, '').trim(),
      images: image ? [image] : [],
      seller: this.text($, '#sellerProfileTriggerId') || 'Amazon',
      productUrl: url || undefined,
      externalProductId: this.extractAsinFromUrl(url) || undefined,
      currency: 'INR',
    };
  }

  parseSearchPage(html, baseUrl = 'https://www.amazon.in') {
    const $ = this.load(html);
    const results = [];
    const seen = new Set();

    $('[data-component-type="s-search-result"], .s-result-item[data-asin]').each((_, el) => {
      const $card = $(el);
      const asin = ($card.attr('data-asin') || '').trim().toUpperCase();
      if (!asin || asin.length < 10 || seen.has(asin)) return;
      seen.add(asin);

      // Fashion cards split the brand ("Nike") and the product name into two <h2>s —
      // keep the longest heading and prefix the short brand line when it's missing.
      const heads = $card
        .find('h2')
        .map((_, h) => $(h).text().replace(/\s+/g, ' ').trim())
        .get()
        .filter(Boolean);
      let title = [...heads].sort((a, b) => b.length - a.length)[0] || '';
      const brandLine = heads.find((h) => h !== title && h.split(' ').length <= 4);
      if (brandLine && !title.toLowerCase().startsWith(brandLine.toLowerCase())) title = `${brandLine} ${title}`;
      if (title.split(' ').length <= 2) {
        const alt = ($card.find('img.s-image').first().attr('alt') || '').replace(/^Sponsored Ad\s*-\s*/i, '').trim();
        if (alt.length > title.length) title = alt;
      }

      const href = $card.find('h2 a').first().attr('href') || `/dp/${asin}`;
      const productUrl = href.startsWith('http')
        ? href.split('?')[0]
        : new URL(href, baseUrl).toString().split('?')[0];

      let price = parsePrice(
        $card.find('.a-price .a-offscreen').first().text() ||
          $card.find('.a-price-whole').first().text()
      );
      if (price == null) {
        const money = $card.text().match(/₹\s*([\d,]+)/);
        if (money) price = parsePrice(money[0]);
      }

      const image =
        $card.find('img.s-image').first().attr('src') ||
        $card.find('img').first().attr('src') ||
        null;

      const ratingText = $card.find('span.a-icon-alt, i.a-icon-star-small span').first().text();
      const ratingMatch = ratingText && ratingText.match(/([\d.]+)/);
      const rating = ratingMatch ? Number(ratingMatch[1]) : null;

      if (!title) return;

      results.push({
        externalProductId: asin,
        title,
        currentPrice: price,
        mrp: null,
        rating: Number.isFinite(rating) ? rating : null,
        productUrl: productUrl.includes('/dp/') ? productUrl : `${baseUrl}/dp/${asin}`,
        images: image ? [image] : [],
        currency: 'INR',
        availability: 'IN_STOCK',
        seller: 'Amazon',
        identifiers: { asin },
      });
    });

    return results;
  }
}

module.exports = AmazonParser;
