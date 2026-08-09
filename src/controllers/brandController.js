const brandService = require('../services/brandService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const top = asyncHandler(async (req, res) => {
  const data = await brandService.getTopBrands({
    limit: req.query.limit,
    productsPerBrand: req.query.productsPerBrand,
    minDiscount: req.query.minDiscount,
  });
  return ApiResponse.success(res, data);
});

const categories = asyncHandler(async (req, res) => {
  const data = await brandService.getCategorySections({
    brandsPerCategory: req.query.limit || req.query.brandsPerCategory,
  });
  return ApiResponse.success(res, data);
});

module.exports = { top, categories };
