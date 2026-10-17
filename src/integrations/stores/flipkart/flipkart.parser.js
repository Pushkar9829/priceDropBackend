const StoreParser = require('../base/StoreParser');
const { CollectionError, FETCH_ERRORS } = require('../base/store.types');
const { parsePrice } = require('../base/normalizer');

/**
 * Flipkart HTML parser — works for fixture pages and live flipkart.com PDPs.
 * Class names change often; multiple selectors + JSON-LD keep it resilient.
 */
class FlipkartParser extends StoreParser {
  extractPidFromUrl(url = '') {
    try {
      const u = new URL(url);
      const pid = u.searchParams.get('pid');
      if (pid) return pid;
      const pathMatch = u.pathname.match(/\/p\/([^/?#]+)/i);
      return pathMatch?.[1] || null;
    } catch {
      return null;
    }
  }

  extractFromScripts(html) {
    const out = {};

    const ldMatches = html.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    );

    for (const match of ldMatches) {
      try {
        const data = JSON.parse(match[1].trim());
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const type = item['@type'];
          const isProduct =
            type === 'Product' ||
            (Array.isArray(type) && type.includes('Product')) ||
            (typeof type === 'string' && type.includes('Product'));
          if (!isProduct) continue;

          if (item.name) out.title = item.name;
          if (item.brand?.name) out.brand = item.brand.name;
          if (typeof item.brand === 'string') out.brand = item.brand;
          if (item.image) {
            out.images = Array.isArray(item.image) ? item.image : [item.image];
          }
          const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
          if (offer?.price != null) out.currentPrice = parsePrice(offer.price);
          if (offer?.availability) out.availability = String(offer.availability);
          if (item.aggregateRating?.ratingValue != null) {
            out.rating = Number(item.aggregateRating.ratingValue);
          }
          if (item.aggregateRating?.reviewCount != null) {
            out.reviewCount = Number(item.aggregateRating.reviewCount);
          }
        }
      } catch {
        // ignore malformed JSON-LD
      }
    }

    // Note: window.__INITIAL_STATE__ "finalPrice" values belong to add-ons (extended warranty,
    // screen protection — "digitalType":"EW"), not the product: a ₹15,000 phone read as ₹152.
    return out;
  }

  /**
   * The price block shoppers see under the title, read from the page's text in order:
   *
   *   title · "4.3" · "| 83,153" · [badge] · "25%" · "41,300" · "₹30,999" · "Buy at ₹25,706"
   *
   * (discount %, MRP without ₹, selling price). Phone pages without that block show it on
   * the selected variant chip instead: "Variant:" · "128 GB + 4 GB" · … · "128 GB + 4 GB" ·
   * "↓31%" · "25,999" · "₹17,999". Class names are obfuscated and change, the order doesn't.
   */
  mainPriceBlock($) {
    const tokens = [];
    const walk = (node) => {
      for (const ch of node.children || []) {
        if (ch.type === 'text') {
          const t = ch.data.replace(/\s+/g, ' ').trim();
          if (t) tokens.push(t);
        } else if (ch.type === 'tag' && !['script', 'style', 'noscript'].includes(ch.name)) {
          walk(ch);
        }
      }
    };
    const body = $('body')[0];
    if (!body) return {};
    walk(body);

    const STOP = /^(Delivery details|Delivery by|Product highlights|Similar Products|Bank offers|Specifications|See other sellers|Seller:)/;
    const RUPEES = /^₹\s?[\d,]+$/;
    const AMOUNT = /^[\d,]+$/;
    const PCT = /^↓?\d{1,2}%( off)?$/i;
    const OOS = /^(Sold Out|Out of stock|Currently unavailable|Coming soon)/i;
    const readAround = (i) => {
      const price = parsePrice(tokens[i]);
      const mrp = i >= 2 && AMOUNT.test(tokens[i - 1]) && PCT.test(tokens[i - 2]) ? parsePrice(tokens[i - 1]) : null;
      return { price, mrp };
    };

    // 1. The block after the rating ("| 83,153"), up to delivery/seller info
    const start = tokens.findIndex((t) => /^Sale ends in/.test(t));
    const rating = tokens.findIndex((t, i) => i > start && /^\|\s?[\d,.]+[KkL+]*$/.test(t));
    if (rating > -1) {
      for (let i = rating + 1; i < Math.min(tokens.length, rating + 12) && !STOP.test(tokens[i]); i += 1) {
        if (OOS.test(tokens[i])) return { outOfStock: true };
        if (RUPEES.test(tokens[i])) return readAround(i);
      }
    }

    // 2. The selected variant's chip
    const v = tokens.findIndex((t, i) => i > start && t === 'Variant:');
    if (v > -1 && tokens[v + 1]) {
      const label = tokens[v + 1];
      const chip = tokens.indexOf(label, v + 2);
      if (chip > -1) {
        for (let i = chip + 1; i < Math.min(tokens.length, chip + 5); i += 1) {
          if (OOS.test(tokens[i])) return { outOfStock: true };
          if (RUPEES.test(tokens[i])) return readAround(i);
        }
      }
    }
    return {};
  }

  parseProductPage(html, url = '') {
    const $ = this.load(html);
    const fromScripts = this.extractFromScripts(html);

    const title =
      fromScripts.title ||
      this.text($, 'span.VU-ZEz') ||
      this.text($, 'span.B_NuCI') ||
      this.text($, 'h1.yhB1nd span') ||
      this.text($, 'h1 span') ||
      this.text($, 'div.RG5Slk') ||
      this.text($, 'h1.product-title') ||
      this.text($, 'h1');

    const main = this.mainPriceBlock($);
    // No seller right now: the page offers "Notify Me" instead of a cart/buy button
    // (as rendered text, or as the button label in the server-rendered state JSON)
    const button = (label) => new RegExp(`(>\\s*|"text":")(${label})\\s*("|<)`, 'i').test(html);
    if (button('Notify Me') && !button('Add to cart|Buy now')) main.outOfStock = true;
    const currentPrice =
      main.price ??
      fromScripts.currentPrice ??
      this.priceFromSelectors($, [
        'div.Nx9bqj',
        'div.oFEPlD',
        'div.hZ3P6w',
        'div._30jeq3._16Jk6d',
        'div._30jeq3',
        'div._25b18c',
        '.pdp-price',
        '.price',
      ]);

    const mrp =
      (main.price ? main.mrp : null) ??
      this.priceFromSelectors($, ['div.yRaY8j', 'div._3I9_wc', 'div.kRYCnD', 'div.yRaY8j.A6+E6v']);

    const ratingText =
      this.text($, 'div.XQDdHH') ||
      this.text($, 'div.MKiFS6') ||
      this.text($, 'div._3LWZlK');
    const rating =
      fromScripts.rating ??
      (ratingText ? Number(String(ratingText).replace(/[^\d.]/g, '')) : null);

    const reviewRaw =
      this.text($, 'span.Wphh3N') ||
      this.text($, 'span.PvbNMB') ||
      this.text($, 'span._2_R_DZ');
    let reviewCount = fromScripts.reviewCount ?? null;
    if (reviewCount == null && reviewRaw) {
      const m = reviewRaw.replace(/,/g, '').match(/(\d+)/);
      if (m) reviewCount = Number(m[1]);
    }

    const availabilityText =
      this.text($, 'div._16FRp0') ||
      this.text($, '.availability') ||
      this.text($, '#availability') ||
      fromScripts.availability ||
      '';

    const brand =
      fromScripts.brand ||
      this.attr($, '[data-brand]', 'data-brand') ||
      this.text($, 'span.mEh187') ||
      this.text($, 'a.R0ZGQ3') ||
      '';

    const image =
      (fromScripts.images && fromScripts.images[0]) ||
      this.attr($, 'img._396cs4', 'src') ||
      this.attr($, 'img.DByuf4', 'src') ||
      this.attr($, 'img.UCc1lI', 'src') ||
      this.attr($, '#landingImage', 'src') ||
      '';

    const images = fromScripts.images?.length
      ? fromScripts.images
      : image
        ? [image]
        : [];

    const seller =
      this.text($, '#sellerName span') ||
      this.text($, 'div.max-w-line-2') ||
      this.text($, 'div.yeLeBC a') ||
      'Flipkart';

    if (!title) {
      if (/page you are looking for has been moved or deleted/i.test($.root().text().replace(/\s+/g, ' '))) {
        throw new CollectionError('Flipkart: product page removed', FETCH_ERRORS.PRODUCT_NOT_FOUND);
      }
      const snippet = $.text().slice(0, 2000);
      const blocked = /detect|captcha|access denied|something went wrong/i.test(snippet);
      throw new CollectionError(
        blocked
          ? 'Flipkart blocked or challenged the request (CAPTCHA / bot check)'
          : 'Flipkart parser: title missing',
        FETCH_ERRORS.PARSE_FAILURE
      );
    }

    return {
      title,
      currentPrice,
      mrp,
      availability: main.outOfStock ? 'OUT_OF_STOCK' : this.availabilityFromText(availabilityText || 'IN_STOCK'),
      brand,
      images,
      seller,
      rating: Number.isFinite(rating) ? rating : null,
      reviewCount,
      productUrl: url || undefined,
      externalProductId: this.extractPidFromUrl(url) || undefined,
      currency: 'INR',
    };
  }

  parseSearchPage(html, baseUrl = 'https://www.flipkart.com') {
    const $ = this.load(html);
    const results = [];
    const seen = new Set();

    $('div[data-id]').each((_, el) => {
      const $card = $(el);
      const id = $card.attr('data-id');
      if (!id || seen.has(id)) return;
      seen.add(id);

      const $link = $card.find('a[href*="/p/"]').first();
      const href = $link.attr('href') || '';
      const productUrl = href
        ? href.startsWith('http')
          ? href
          : new URL(href, baseUrl).toString()
        : null;

      const $img = $card.find('img.UCc1lI, img').first();
      const cardText = (sel) => $card.find(sel).first().text().replace(/\s+/g, ' ').trim();
      // Fashion/grid cards: brand on its own line + the full name in a link's title attribute
      const gridName = ($card.find('a[title]').first().attr('title') || '').replace(/\s+/g, ' ').trim();
      const gridBrand = cardText('div.Fo1I0b') || cardText('div.syl9yP');
      const gridTitle =
        gridName && gridBrand && !gridName.toLowerCase().startsWith(gridBrand.toLowerCase())
          ? `${gridBrand} ${gridName}`
          : gridName;
      const title =
        cardText('div.RG5Slk') ||
        cardText('div.KzDlHZ') ||
        cardText('div._4rR01T') ||
        gridTitle ||
        $img.attr('alt') ||
        $link.attr('title') ||
        '';

      let price = parsePrice(
        cardText('div.hZ3P6w') ||
          cardText('div.oFEPlD') ||
          cardText('div.Nx9bqj') ||
          cardText('div._30jeq3')
      );
      let mrp = parsePrice(
        cardText('div.kRYCnD') || cardText('div.yRaY8j') || cardText('div._3I9_wc')
      );

      // Fallback: first ₹ amount in the card text (Flipkart class names change often)
      if (price == null) {
        const money = $card.text().match(/₹\s*([\d,]+)/g) || [];
        if (money[0]) price = parsePrice(money[0]);
        if (mrp == null && money[1]) mrp = parsePrice(money[1]);
      }
      const ratingText =
        cardText('div.MKiFS6') || cardText('div.XQDdHH') || cardText('div._3LWZlK');
      const rating = ratingText
        ? Number(String(ratingText).replace(/[^\d.]/g, ''))
        : null;
      const image = $img.attr('src') || $img.attr('data-src') || null;

      if (!title) return;

      results.push({
        externalProductId: id,
        title,
        currentPrice: price,
        mrp,
        rating: Number.isFinite(rating) ? rating : null,
        productUrl,
        images: image ? [image] : [],
        currency: 'INR',
        availability: 'IN_STOCK',
        seller: 'Flipkart',
      });
    });

    return results;
  }
}

module.exports = FlipkartParser;
