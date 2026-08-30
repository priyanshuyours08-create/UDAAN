const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// One Application row = one approval being pursued (e.g. "Fire NOC for Applicant #3").
// An applicant submitting once generates multiple Application rows —
// one per required approval — which then progress independently/in parallel.
const Application = sequelize.define('Application', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  applicant_id: { type: DataTypes.INTEGER, allowNull: false },
  approval_rule_id: { type: DataTypes.INTEGER, allowNull: false },
  status: {
    type: DataTypes.ENUM(
      'submitted',
      'auto_approved',
      'pending_review',
      'pending_inspection',
      'approved',
      'rejected'
    ),
    defaultValue: 'submitted',
  },
  risk_level: {
    type: DataTypes.ENUM('low', 'medium', 'high'),
    allowNull: true,
  },
  submitted_document_ids: {
    type: DataTypes.TEXT,
    defaultValue: '[]',
    get() {
      const raw = this.getDataValue('submitted_document_ids');
      return raw ? JSON.parse(raw) : [];
    },
    set(val) {
      this.setDataValue('submitted_document_ids', JSON.stringify(val));
    },
  },
  sla_deadline: { type: DataTypes.DATE },
  submitted_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  decided_at: { type: DataTypes.DATE, allowNull: true },
  last_notified_level: {
    type: DataTypes.ENUM('none', 'warning', 'breach'),
    allowNull: false,
    defaultValue: 'none',
  },
}, {
  indexes: [
    {
      name: 'app_sla_polling_idx',
      fields: ['status', 'sla_deadline', 'last_notified_level']
    }
  ]
});

module.exports = Application;
