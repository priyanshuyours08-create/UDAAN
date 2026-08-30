const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Notification = sequelize.define('Notification', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  type: {
    type: DataTypes.ENUM(
      'sla_warning',
      'sla_breach',
      'grievance_update',
      'application_update',
      'scheme_recommendation'
    ),
    allowNull: false
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  reference_type: {
    type: DataTypes.STRING,
    allowNull: true
  },
  reference_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  is_read: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  }
}, {
  timestamps: true,
  indexes: [
    {
      name: 'notif_user_read_time_idx',
      fields: ['user_id', 'is_read', 'createdAt']
    },
    {
      name: 'notif_reference_idx',
      fields: ['reference_type', 'reference_id', 'type']
    }
  ]
});

module.exports = Notification;
