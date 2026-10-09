const express = require('express');
const notificationController = require('../controllers/notificationController');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { mongoIdParam } = require('../middleware/validators');

const router = express.Router();

router.use(protect);

router.get('/', notificationController.list);
router.get('/unread-count', notificationController.unreadCount);
router.patch('/read-all', notificationController.markAllRead);
router.patch('/:id/read', mongoIdParam('id'), validate, notificationController.markRead);

module.exports = router;
