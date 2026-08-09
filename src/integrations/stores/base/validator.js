const { CollectionError, FETCH_ERRORS } = require('./store.types');

/**
 * Validate normalized product data BEFORE saving prices.
 * Invalid / missing price must never overwrite a stored valid price.
 */
const validateNormalizedProduct = (data, { requireUrl = false } = {}) => {
  const errors = [];

  if (!data) {
    throw new CollectionError('Empty product payload', FETCH_ERRORS.VALIDATION_FAILURE);
  }

  if (!data.externalProductId) {
    errors.push('externalProductId is required');
  }

  if (!data.title || data.title.length < 2) {
    errors.push('title is required');
  }

  if (data.currentPrice == null || typeof data.currentPrice !== 'number') {
    errors.push('price must be numeric');
  } else if (!(data.currentPrice > 0)) {
    errors.push('price must be greater than zero');
  }

  if (!data.currency || typeof data.currency !== 'string') {
    errors.push('currency is required');
  }

  if (requireUrl && !data.productUrl) {
    errors.push('productUrl is required');
  }

  if (errors.length) {
    throw new CollectionError(
      `Validation failed: ${errors.join('; ')}`,
      FETCH_ERRORS.VALIDATION_FAILURE,
      { errors }
    );
  }

  return true;
};

/**
 * Returns true only for a usable price value.
 */
const isValidPrice = (price) =>
  typeof price === 'number' && Number.isFinite(price) && price > 0;

module.exports = {
  validateNormalizedProduct,
  isValidPrice,
};
