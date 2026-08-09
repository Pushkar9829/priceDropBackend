const authService = require('../services/authService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const register = asyncHandler(async (req, res) => {
  const data = await authService.register(req.body);
  return ApiResponse.created(res, data, 'Registration successful');
});

const login = asyncHandler(async (req, res) => {
  const data = await authService.login(req.body);
  return ApiResponse.success(res, data, 'Login successful');
});

const logout = asyncHandler(async (req, res) => {
  // Stateless JWT — client discards token. Hook for blacklist later if needed.
  return ApiResponse.success(res, null, 'Logged out successfully');
});

const me = asyncHandler(async (req, res) => {
  const data = await authService.getMe(req.user._id);
  return ApiResponse.success(res, data);
});

module.exports = { register, login, logout, me };
