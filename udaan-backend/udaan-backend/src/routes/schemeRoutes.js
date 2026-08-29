const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { matchSchemes } = require('../controllers/schemeController');

router.get('/match/:applicantId', authenticate, matchSchemes);

module.exports = router;
