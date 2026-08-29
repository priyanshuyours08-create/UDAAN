const { DocumentVault, ApplicantProfile } = require('../models');

// In a real deployment, file_url would come from an actual file upload
// (multer + S3/local storage). For the hackathon MVP, the frontend can send
// a URL/base64 placeholder and this endpoint just registers it in the vault.
async function uploadDocument(req, res) {
  try {
    const { applicant_id, document_type, file_url, expiry_date } = req.body;
    if (!applicant_id || !document_type || !file_url) {
      return res.status(400).json({ error: 'applicant_id, document_type and file_url are required' });
    }

    if (typeof document_type !== 'string' || document_type.trim().length === 0) {
      return res.status(400).json({ error: 'document_type must be a non-empty string' });
    }

    try {
      new URL(file_url);
    } catch {
      return res.status(400).json({ error: 'file_url is not a valid URL' });
    }

    if (expiry_date) {
      const expDate = new Date(expiry_date);
      if (isNaN(expDate.getTime())) {
        return res.status(400).json({ error: 'Invalid expiry_date format' });
      }
      if (expDate < new Date()) {
        return res.status(400).json({ error: 'Document has expired (expiry_date is in the past)' });
      }
    }

    let profile;
    if (req.user.role === 'applicant') {
      profile = await ApplicantProfile.findOne({
        where: { id: applicant_id, user_id: req.user.id },
      });
      if (!profile) {
        return res.status(403).json({ error: 'Applicant profile not found or access denied' });
      }
    } else {
      profile = await ApplicantProfile.findByPk(applicant_id);
      if (!profile) return res.status(404).json({ error: 'Applicant profile not found' });
    }

    // Security: Applicants cannot self-verify documents. Any applicant-supplied
    // verified_status is ignored, ensuring all applicant uploads default to 'pending'.
    // Only officers and admins can explicitly set verified_status during upload or via the verify endpoint.
    let verifiedStatus = 'pending';
    if (['officer', 'admin'].includes(req.user.role) && req.body.verified_status) {
      if (['pending', 'verified', 'rejected'].includes(req.body.verified_status)) {
        verifiedStatus = req.body.verified_status;
      }
    }

    const doc = await DocumentVault.create({
      applicant_id,
      document_type: document_type.trim(),
      file_url,
      expiry_date: expiry_date || null,
      verified_status: verifiedStatus,
    });

    res.status(201).json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Returns everything already in the vault for this applicant — this is what
// lets the application-submission step auto-fill documents instead of asking
// the applicant to upload them again per department.
async function getVault(req, res) {
  try {
    const applicantId = req.params.applicantId;
    if (req.user.role === 'applicant') {
      const profile = await ApplicantProfile.findOne({
        where: { id: applicantId, user_id: req.user.id },
      });
      if (!profile) {
        return res.status(403).json({ error: 'Applicant profile not found or access denied' });
      }
    }

    const docs = await DocumentVault.findAll({
      where: { applicant_id: applicantId },
    });
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Officer/Admin endpoint: updates document verified_status ('verified' | 'rejected' | 'pending')
async function verifyDocument(req, res) {
  try {
    const { documentId } = req.params;
    const { verified_status } = req.body;
    if (!['verified', 'rejected', 'pending'].includes(verified_status)) {
      return res.status(400).json({ error: "verified_status must be 'verified', 'rejected', or 'pending'" });
    }

    const doc = await DocumentVault.findByPk(documentId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    doc.verified_status = verified_status;
    await doc.save();

    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { uploadDocument, getVault, verifyDocument };
