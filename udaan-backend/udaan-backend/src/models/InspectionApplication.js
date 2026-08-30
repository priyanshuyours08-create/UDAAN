const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Join table connecting Inspections to Applications (many-to-many).
// The unique constraint on (inspection_id, application_id) is the final
// database-level protection against duplicate links — even if the application
// layer's concurrency controls are bypassed.
const InspectionApplication = sequelize.define('InspectionApplication', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  inspection_id: { type: DataTypes.INTEGER, allowNull: false },
  application_id: { type: DataTypes.INTEGER, allowNull: false },
}, {
  indexes: [
    {
      unique: true,
      fields: ['inspection_id', 'application_id'],
      name: 'unique_inspection_application',
    },
  ],
});

module.exports = InspectionApplication;
