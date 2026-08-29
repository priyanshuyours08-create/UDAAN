const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// This is the "Regulatory Knowledge Graph" simplified into a rules table.
// Each row says: "for this sector + state + investment range + stage,
// this approval is required, from this department, needing these documents,
// within this many SLA days."
// Admins can add new rows to instantly update every applicant's checklist —
// no code changes needed to onboard a new regulation, state, or sector.
const ApprovalRule = sequelize.define('ApprovalRule', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  sector: { type: DataTypes.STRING, allowNull: false }, // 'food_processing', 'textile', 'all'
  state: { type: DataTypes.STRING, allowNull: false }, // specific state or 'all'
  stage: {
    type: DataTypes.ENUM('pre_establishment', 'construction', 'operational', 'renewal', 'all'),
    defaultValue: 'all',
  },
  min_investment: { type: DataTypes.FLOAT, defaultValue: 0 }, // in INR lakhs
  max_investment: { type: DataTypes.FLOAT, defaultValue: 999999999 },
  approval_name: { type: DataTypes.STRING, allowNull: false }, // 'Fire NOC'
  department: { type: DataTypes.STRING, allowNull: false }, // 'Fire Department'
  required_documents: {
    type: DataTypes.TEXT, // stored as JSON string, e.g. ["Site plan","Ownership proof"]
    allowNull: false,
    get() {
      const raw = this.getDataValue('required_documents');
      return raw ? JSON.parse(raw) : [];
    },
    set(val) {
      this.setDataValue('required_documents', JSON.stringify(val));
    },
  },
  sla_days: { type: DataTypes.INTEGER, defaultValue: 15 },
  hazard_level: {
    type: DataTypes.ENUM('low', 'medium', 'high'),
    defaultValue: 'low',
  }, // used by the risk-scoring engine
  requires_inspection: { type: DataTypes.BOOLEAN, defaultValue: false },
});

module.exports = ApprovalRule;
