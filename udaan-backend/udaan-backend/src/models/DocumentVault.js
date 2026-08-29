const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// The "verify once, reuse everywhere" vault. A document is uploaded once
// per applicant (not per department/application) and referenced by ID
// wherever it's needed — this is what eliminates repeat submission.
const DocumentVault = sequelize.define('DocumentVault', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  applicant_id: { type: DataTypes.INTEGER, allowNull: false },
  document_type: { type: DataTypes.STRING, allowNull: false }, // 'PAN', 'Udyam Certificate', etc.
  file_url: { type: DataTypes.STRING, allowNull: false },
  verified_status: {
    type: DataTypes.ENUM('pending', 'verified', 'rejected'),
    defaultValue: 'pending',
  },
  uploaded_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  expiry_date: { type: DataTypes.DATE, allowNull: true },
});

module.exports = DocumentVault;
