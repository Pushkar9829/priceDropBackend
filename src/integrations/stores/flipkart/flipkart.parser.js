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

    const stateMatch = html.match(
      /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/
    );
    if (stateMatch?.[1] && out.currentPrice == null) {
      try {
        const flat = stateMatch[1];
        const priceHit = flat.match(/"finalPrice"\s*:\s*\{[^}]*"value"\s*:\s*(\d+)/);
        if (priceHit) out.currentPrice = Number(priceHit[1]);
      } catch {
        // ignore
      }
    }

    return out;
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

    const currentPrice =
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

    const mrp = this.priceFromSelectors($, [
      'div.yRaY8j',
      'div._3I9_wc',
      'div.kRYCnD',
      'div.yRaY8j.A6+E6v',
    ]);

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
      availability: this.availabilityFromText(availabilityText || 'IN_STOCK'),
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
      const title =
        cardText('div.RG5Slk') ||
        cardText('div.KzDlHZ') ||
        cardText('div._4rR01T') ||
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
