const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { createProfile, getMyProfile } = require('../controllers/applicantController');

router.post('/profile', authenticate, createProfile);
router.get('/profile/me', authenticate, getMyProfile);

module.exports = router;
