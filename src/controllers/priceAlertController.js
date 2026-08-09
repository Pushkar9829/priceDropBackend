const alertService = require('../services/alertService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const create = asyncHandler(async (req, res) => {
  const alert = await alertService.createAlert(req.user._id, req.body);
  return ApiResponse.created(res, alert, 'Price alert created');
});

const list = asyncHandler(async (req, res) => {
  const alerts = await alertService.listAlerts(req.user._id);
  return ApiResponse.success(res, { items: alerts });
});

const update = asyncHandler(async (req, res) => {
  const alert = await alertService.updateAlert(req.user._id, req.params.id, req.body);
  return ApiResponse.success(res, alert, 'Price alert updated');
});

const remove = asyncHandler(async (req, res) => {
  await alertService.deleteAlert(req.user._id, req.params.id);
  return ApiResponse.success(res, null, 'Price alert cancelled');
});

module.exports = { create, list, update, remove };
