const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { getChecklist } = require('../controllers/checklistController');

router.get('/:applicantId', authenticate, getChecklist);

module.exports = router;
