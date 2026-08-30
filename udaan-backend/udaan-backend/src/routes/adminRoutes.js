const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { getAnalytics, runSlaCheck } = require('../controllers/adminController');

router.get('/analytics', authenticate, authorize('admin', 'officer'), getAnalytics);
router.post('/run-sla-check', authenticate, authorize('admin', 'officer'), runSlaCheck);

module.exports = router;
