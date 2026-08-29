const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { uploadDocument, getVault, verifyDocument } = require('../controllers/vaultController');

router.post('/upload', authenticate, uploadDocument);
router.get('/:applicantId', authenticate, getVault);
router.patch('/:documentId/verify', authenticate, authorize('officer', 'admin'), verifyDocument);

module.exports = router;
