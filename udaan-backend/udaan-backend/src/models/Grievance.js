const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Grievance = sequelize.define('Grievance', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  applicant_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  application_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  subject: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('open', 'in_progress', 'escalated', 'resolved', 'closed'),
    allowNull: false,
    defaultValue: 'open'
  },
  priority: {
    type: DataTypes.ENUM('low', 'medium', 'high'),
    allowNull: false,
    defaultValue: 'medium'
  },
  assigned_to: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  department: {
    type: DataTypes.STRING,
    allowNull: true
  },
  classified_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  classified_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  resolution_notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  escalation_level: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: {
      min: 0,
      max: 3
    }
  },
  sla_deadline: {
    type: DataTypes.DATE,
    allowNull: false
  },
  next_escalation_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  state_version: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  resolved_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  timestamps: true,
  indexes: [
    {
      name: 'idx_grievance_applicant_createdAt',
      fields: ['applicant_id', 'createdAt']
    },
    {
      name: 'idx_grievance_assigned_status',
      fields: ['assigned_to', 'status']
    },
    {
      name: 'idx_grievance_dept_status_assigned',
      fields: ['department', 'status', 'assigned_to']
    },
    {
      name: 'idx_grievance_status_deadlines_level',
      fields: ['status', 'sla_deadline', 'next_escalation_at', 'escalation_level']
    },
    {
      name: 'idx_grievance_application_id',
      fields: ['application_id']
    }
  ]
});

module.exports = Grievance;
