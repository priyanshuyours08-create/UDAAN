const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { getAnalytics } = require('../controllers/adminController');

router.get('/analytics', authenticate, authorize('admin', 'officer'), getAnalytics);

module.exports = router;
