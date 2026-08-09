const watchlistService = require('../services/watchlistService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const add = asyncHandler(async (req, res) => {
  const item = await watchlistService.addToWatchlist(req.user._id, req.params.productId);
  return ApiResponse.created(res, item, 'Added to watchlist');
});

const remove = asyncHandler(async (req, res) => {
  await watchlistService.removeFromWatchlist(req.user._id, req.params.productId);
  return ApiResponse.success(res, null, 'Removed from watchlist');
});

const list = asyncHandler(async (req, res) => {
  const items = await watchlistService.getWatchlist(req.user._id);
  return ApiResponse.success(res, { items });
});

module.exports = { add, remove, list };
