const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// This profile is the input to the checklist-matching engine.
// sector, state, investment_amount, employee_count and stage together
// determine which Approval Rules apply to this applicant.
const ApplicantProfile = sequelize.define('ApplicantProfile', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  business_name: { type: DataTypes.STRING, allowNull: false },
  sector: { type: DataTypes.STRING, allowNull: false }, // e.g. 'food_processing'
  nic_code: { type: DataTypes.STRING },
  state: { type: DataTypes.STRING, allowNull: false },
  district: { type: DataTypes.STRING },
  investment_amount: { type: DataTypes.FLOAT, allowNull: false }, // in INR lakhs
  employee_count: { type: DataTypes.INTEGER, allowNull: false },
  stage: {
    type: DataTypes.ENUM('pre_establishment', 'construction', 'operational', 'renewal'),
    defaultValue: 'pre_establishment',
  },
});

module.exports = ApplicantProfile;
