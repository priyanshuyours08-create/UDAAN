const express = require('express');
const router = express.Router();
const { authenticate, authorize, analyticsScope } = require('../middleware/auth');
const { runSlaCheck } = require('../controllers/adminController');
const { getOverviewAnalytics, getSlaAnalytics, getDepartmentBottleneckAnalytics, getInspectionAnalytics, getGrievanceAnalytics } = require('../controllers/analyticsController');

// Priority 6 Stage 1: Security Foundation & Secure Legacy Analytics Route
router.get('/analytics/overview', authenticate, authorize('admin', 'officer'), analyticsScope, getOverviewAnalytics);

// Legacy alias to identical overview controller with the new auth scope applied
router.get('/analytics', authenticate, authorize('admin', 'officer'), analyticsScope, getOverviewAnalytics);

// Priority 6 Stage 2: SLA and Department Bottlenecks
router.get('/analytics/sla', authenticate, authorize('admin', 'officer'), analyticsScope, getSlaAnalytics);
router.get('/analytics/departments', authenticate, authorize('admin', 'officer'), analyticsScope, getDepartmentBottleneckAnalytics);
router.get('/analytics/inspections', authenticate, authorize('admin', 'officer'), analyticsScope, getInspectionAnalytics);
router.get('/analytics/grievances', authenticate, authorize('admin', 'officer'), analyticsScope, getGrievanceAnalytics);
router.post('/run-sla-check', authenticate, authorize('admin', 'officer'), runSlaCheck);

module.exports = router;
