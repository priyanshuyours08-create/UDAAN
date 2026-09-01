const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Common Inspection Planner (PRD §5.6): One inspection bundles multiple
// applications for a single applicant, so departments can perform a joint
// site visit instead of separate ones. Created via the bundle endpoint.
const Inspection = sequelize.define('Inspection', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  applicant_id: { type: DataTypes.INTEGER, allowNull: false },
  scheduled_date: {
    type: DataTypes.DATE,
    defaultValue: () => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      return d;
    },
  },
  status: {
    type: DataTypes.ENUM('scheduled', 'completed', 'cancelled'),
    defaultValue: 'scheduled',
  },
  inspector_notes: { type: DataTypes.TEXT, allowNull: true },
  result: {
    type: DataTypes.ENUM('pass', 'fail', 'conditional'),
    allowNull: true,
    defaultValue: null,
  },
  assigned_inspector_id: { type: DataTypes.INTEGER, allowNull: true },
  completed_at: { type: DataTypes.DATE, allowNull: true },
});

module.exports = Inspection;
