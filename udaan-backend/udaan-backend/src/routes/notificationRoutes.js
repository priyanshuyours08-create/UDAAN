const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
  getUserNotifications,
  markAllAsRead,
  markAsRead
} = require('../controllers/notificationController');

// All routes require authentication
router.use(authenticate);

// Important route order: /read-all before /:id/read
router.get('/', getUserNotifications);
router.patch('/read-all', markAllAsRead);
router.patch('/:id/read', markAsRead);

module.exports = router;
