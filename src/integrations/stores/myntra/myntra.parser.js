const StoreParser = require('../base/StoreParser');
const { CollectionError, FETCH_ERRORS } = require('../base/store.types');

class MyntraParser extends StoreParser {
  parseProductPage(html) {
    const $ = this.load(html);

    const title =
      this.text($, 'h1.pdp-name') ||
      this.text($, 'h1.product-title') ||
      this.text($, 'h1');

    const price = this.priceFromSelectors($, [
      'span.pdp-price',
      'strong.pdp-price',
      '.pdp-price',
      '.price',
      '.a-price-whole',
    ]);

    const mrp = this.priceFromSelectors($, ['.pdp-mrp', '.pdp-discount-container s']);

    if (!title) {
      throw new CollectionError('Myntra parser: title missing', FETCH_ERRORS.PARSE_FAILURE);
    }

    return {
      title,
      currentPrice: price,
      mrp,
      availability: this.text($, '.availability') || 'UNKNOWN',
      brand: this.attr($, '[data-brand]', 'data-brand') || this.text($, 'h1.pdp-title'),
      images: (() => {
        const src = this.attr($, '#landingImage', 'src') || this.attr($, 'img.image-grid-image', 'src');
        return src ? [src] : [];
      })(),
      seller: 'Myntra',
    };
  }

  parseSearchPage() {
    return [];
  }
}

module.exports = MyntraParser;
