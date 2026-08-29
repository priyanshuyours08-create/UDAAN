const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { uploadDocument, getVault } = require('../controllers/vaultController');

router.post('/upload', authenticate, uploadDocument);
router.get('/:applicantId', authenticate, getVault);

module.exports = router;
