const express = require('express');
const router = express.Router();
const { authenticate, authorize, analyticsScope } = require('../middleware/auth');
const { runSlaCheck } = require('../controllers/adminController');
const { getOverviewAnalytics } = require('../controllers/analyticsController');

// Priority 6 Stage 1: Security Foundation & Secure Legacy Analytics Route
router.get('/analytics/overview', authenticate, authorize('admin', 'officer'), analyticsScope, getOverviewAnalytics);

// Legacy alias to identical overview controller with the new auth scope applied
router.get('/analytics', authenticate, authorize('admin', 'officer'), analyticsScope, getOverviewAnalytics);

router.post('/run-sla-check', authenticate, authorize('admin', 'officer'), runSlaCheck);

module.exports = router;
