const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const {
  bundleInspections,
  getInspections,
  assignInspector,
  completeInspection,
} = require('../controllers/inspectionController');

// Fail-closed: each route explicitly lists only the allowed roles.
// Officers and inspectors are excluded from bundle; officers are excluded from listing.
router.post('/bundle', authenticate, authorize('applicant', 'admin'), bundleInspections);
router.get('/:applicantId', authenticate, authorize('applicant', 'inspector', 'admin'), getInspections);
router.patch('/:inspectionId/assign', authenticate, authorize('admin'), assignInspector);
router.patch('/:inspectionId/complete', authenticate, authorize('inspector', 'admin'), completeInspection);

module.exports = router;
