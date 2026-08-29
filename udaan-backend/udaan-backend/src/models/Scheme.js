const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Government incentive/subsidy schemes, matched against applicant profiles
// by the scheme-matching engine.
const Scheme = sequelize.define('Scheme', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT },
  sector: { type: DataTypes.STRING, defaultValue: 'all' }, // 'all' or specific sector
  state: { type: DataTypes.STRING, defaultValue: 'all' },
  min_investment: { type: DataTypes.FLOAT, defaultValue: 0 },
  max_investment: { type: DataTypes.FLOAT, defaultValue: 999999999 },
  min_employees: { type: DataTypes.INTEGER, defaultValue: 0 },
  benefit_description: { type: DataTypes.TEXT },
});

module.exports = Scheme;
