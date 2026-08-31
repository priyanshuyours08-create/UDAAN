const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const grievanceController = require('../controllers/grievanceController');

router.post('/', authenticate, grievanceController.createGrievance);
router.get('/mine', authenticate, grievanceController.getMyGrievances);

module.exports = router;
