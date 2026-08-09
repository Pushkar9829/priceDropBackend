const dealService = require('../services/dealService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const data = await dealService.listDeals({
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
  });
  return ApiResponse.success(res, data);
});

module.exports = { list };
