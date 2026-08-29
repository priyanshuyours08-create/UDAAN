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

    const doc = await DocumentVault.create({
      applicant_id,
      document_type: document_type.trim(),
      file_url,
      expiry_date: expiry_date || null,
      verified_status: req.body.verified_status || 'verified',
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

module.exports = { uploadDocument, getVault };
