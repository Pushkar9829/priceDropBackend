const { parsePrice } = require('../base/normalizer');
const StoreParser = require('../base/StoreParser');
const { CollectionError, FETCH_ERRORS } = require('../base/store.types');

/**
 * Amazon HTML parser (Cheerio) — fixtures + live amazon.in.
 */
class AmazonParser extends StoreParser {
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

    const price = this.priceFromSelectors($, [
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '#corePrice_feature_div .a-price .a-offscreen',
      '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
      '.a-price .a-offscreen',
      '.a-price-whole',
      '.price',
    ]);

    const mrp = this.priceFromSelectors($, [
      '.a-text-price .a-offscreen',
      '#listPrice',
      '.basisPrice .a-offscreen',
    ]);

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

      const title =
        $card.find('h2 a span').first().text().trim() ||
        $card.find('h2 span').first().text().trim() ||
        $card.find('h2').first().text().trim();

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
