const productService = require('../services/productService');
const comparisonService = require('../services/comparisonService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const search = asyncHandler(async (req, res) => {
  const { q, page = 1, limit = 20, live } = req.query;
  const data = await productService.searchProducts({
    q,
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    live: live === '1' || live === 'true',
  });
  return ApiResponse.success(res, data);
});

const getById = asyncHandler(async (req, res) => {
  const { product, storeProducts } = await productService.getProductById(req.params.id);
  return ApiResponse.success(res, { product, storeProducts });
});

const getComparison = asyncHandler(async (req, res) => {
  const data = await comparisonService.getComparison(req.params.id);
  return ApiResponse.success(res, data);
});

const getPriceHistory = asyncHandler(async (req, res) => {
  const { storeProductId, days = 90 } = req.query;
  const data = await comparisonService.getPriceHistory(req.params.id, {
    storeProductId,
    days: parseInt(days, 10),
  });
  return ApiResponse.success(res, data);
});

module.exports = { search, getById, getComparison, getPriceHistory };
