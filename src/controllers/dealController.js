const dealService = require('../services/dealService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { createTtlCache } = require('../utils/ttlCache');

const dealsCache = createTtlCache({ ttlMs: 30_000, max: 200 });

const list = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const data = await dealsCache.get(`${page}:${limit}`, () => dealService.listDeals({ page, limit }));
  return ApiResponse.success(res, data);
});

module.exports = { list };
