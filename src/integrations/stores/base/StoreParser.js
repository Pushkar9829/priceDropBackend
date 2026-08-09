const cheerio = require('cheerio');
const { CollectionError, FETCH_ERRORS } = require('./store.types');
const { parsePrice, normalizeAvailability } = require('./normalizer');

/**
 * Base HTML parser helpers. Store-specific parsers extend these patterns.
 */
class StoreParser {
  load(html) {
    if (!html || typeof html !== 'string') {
      throw new CollectionError('Empty HTML for parser', FETCH_ERRORS.PARSE_FAILURE);
    }
    return cheerio.load(html);
  }

  text($, selector) {
    const val = $(selector).first().text();
    return val ? val.replace(/\s+/g, ' ').trim() : '';
  }

  attr($, selector, name) {
    return $(selector).first().attr(name) || '';
  }

  priceFromSelectors($, selectors = []) {
    for (const selector of selectors) {
      const raw = this.text($, selector) || this.attr($, selector, 'content');
      const price = parsePrice(raw);
      if (price) return price;
    }
    return null;
  }

  availabilityFromText(text) {
    return normalizeAvailability(text);
  }

  /**
   * @param {string} html
   * @returns {Object} store-specific raw fields
   */
  parseProductPage(html) {
    throw new Error('parseProductPage must be implemented by store parser');
  }

  /**
   * @param {string} html
   * @returns {Object[]}
   */
  parseSearchPage(html) {
    throw new Error('parseSearchPage must be implemented by store parser');
  }
}

module.exports = StoreParser;
