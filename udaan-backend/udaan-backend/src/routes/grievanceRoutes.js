const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const grievanceController = require('../controllers/grievanceController');

router.post('/', authenticate, grievanceController.createGrievance);
router.get('/mine', authenticate, grievanceController.getMyGrievances);
router.get('/assigned', authenticate, authorize('officer', 'admin'), grievanceController.getAssignedGrievances);
router.patch('/:id/classify', authenticate, authorize('admin'), grievanceController.classifyGrievance);
router.patch('/:id/claim', authenticate, authorize('officer', 'admin'), grievanceController.claimGrievance);
router.patch('/:id', authenticate, authorize('applicant', 'officer', 'admin'), grievanceController.updateGrievanceStatus);

module.exports = router;
