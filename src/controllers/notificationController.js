const notificationService = require('../services/notificationService');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const data = await notificationService.listNotifications(req.user._id, {
    page: parseInt(page, 10) || 1,
    limit: parseInt(limit, 10) || 20,
  });
  return ApiResponse.success(res, data);
});

const unreadCount = asyncHandler(async (req, res) => {
  const count = await notificationService.countUnread(req.user._id);
  return ApiResponse.success(res, { count });
});

const markRead = asyncHandler(async (req, res) => {
  const notification = await notificationService.markAsRead(req.user._id, req.params.id);
  return ApiResponse.success(res, notification, 'Notification marked as read');
});

const markAllRead = asyncHandler(async (req, res) => {
  const updated = await notificationService.markAllAsRead(req.user._id);
  return ApiResponse.success(res, { updated }, 'All notifications marked as read');
});

module.exports = { list, unreadCount, markRead, markAllRead };
