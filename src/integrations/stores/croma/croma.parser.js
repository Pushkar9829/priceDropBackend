const { parsePrice } = require('../base/normalizer');
const StoreParser = require('../base/StoreParser');
const { CollectionError, FETCH_ERRORS } = require('../base/store.types');

class CromaParser extends StoreParser {
  extractIdFromUrl(url = '') {
    try {
      const u = new URL(url);
      const p = u.pathname.match(/\/p\/([^/?#]+)/i);
      if (p?.[1]) return p[1];
      const parts = u.pathname.split('/').filter(Boolean);
      return parts[parts.length - 1] || null;
    } catch {
      return null;
    }
  }

  parseProductPage(html, url = '') {
    const $ = this.load(html);

    const title =
      this.text($, 'h1.pdp-title') ||
      this.text($, 'h1.product-title') ||
      this.text($, '[class*="ProductTitle"]') ||
      this.text($, 'h1');

    const price = this.priceFromSelectors($, [
      '.new-price',
      '.pdp-price',
      '.amount',
      '.cp-price',
      '[class*="Price"]',
      '.price',
      '.a-price-whole',
    ]);

    const mrp = this.priceFromSelectors($, ['.old-price', '.mrp', '[class*="Mrp"]']);

    if (!title) {
      throw new CollectionError('Croma parser: title missing', FETCH_ERRORS.PARSE_FAILURE);
    }

    const image =
      this.attr($, '#landingImage', 'src') ||
      this.attr($, '.pdp-img img', 'src') ||
      this.attr($, 'img[src*="cdn.croma.com"]', 'src') ||
      '';

    return {
      title,
      currentPrice: price,
      mrp,
      availability: this.availabilityFromText(
        this.text($, '.availability') || this.text($, '[class*="stock"]') || 'IN_STOCK'
      ),
      brand: this.attr($, '[data-brand]', 'data-brand') || '',
      images: image ? [image] : [],
      seller: 'Croma',
      productUrl: url || undefined,
      externalProductId: this.extractIdFromUrl(url) || undefined,
      currency: 'INR',
    };
  }

  parseSearchPage(html, baseUrl = 'https://www.croma.com') {
    const $ = this.load(html);
    const results = [];
    const seen = new Set();

    $('a[href*="/p/"]').each((_, el) => {
      const $a = $(el);
      const href = $a.attr('href') || '';
      if (!href || href.includes('javascript')) return;

      const productUrl = href.startsWith('http')
        ? href.split('?')[0]
        : new URL(href, baseUrl).toString().split('?')[0];

      const id = this.extractIdFromUrl(productUrl);
      if (!id || seen.has(id)) return;

      const $card = $a.closest('[class*="product"], [class*="Product"], li, article, div');
      const title =
        $a.attr('title') ||
        $card.find('h3, h2, [class*="title"], [class*="Title"]').first().text().trim() ||
        $a.text().replace(/\s+/g, ' ').trim();

      if (!title || title.length < 4) return;
      // Skip tiny nav / junk links
      if (title.length > 180) return;

      seen.add(id);

      let price = parsePrice(
        $card.find('[class*="price"], [class*="Price"], .amount').first().text()
      );
      if (price == null) {
        const money = $card.text().match(/₹\s*([\d,]+)/);
        if (money) price = parsePrice(money[0]);
      }

      const image =
        $card.find('img').first().attr('src') ||
        $card.find('img').first().attr('data-src') ||
        null;

      results.push({
        externalProductId: id,
        title: title.slice(0, 200),
        currentPrice: price,
        mrp: null,
        rating: null,
        productUrl,
        images: image ? [image] : [],
        currency: 'INR',
        availability: 'IN_STOCK',
        seller: 'Croma',
      });
    });

    return results;
  }
}

module.exports = CromaParser;
