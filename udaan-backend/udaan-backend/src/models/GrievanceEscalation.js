const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const GrievanceEscalation = sequelize.define('GrievanceEscalation', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  grievance_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  from_level: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 0,
      max: 2
    }
  },
  to_level: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 1,
      max: 3
    }
  },
  escalation_type: {
    type: DataTypes.ENUM('manual', 'automatic'),
    allowNull: false
  },
  escalated_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  idempotency_key: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  request_fingerprint: {
    type: DataTypes.STRING(64),
    allowNull: true
  }
}, {
  timestamps: true,
  updatedAt: false,
  indexes: [
    {
      name: 'idx_grievance_escalation_createdAt',
      fields: ['grievance_id', 'createdAt']
    },
    {
      name: 'uq_grievance_idempotency',
      unique: true,
      fields: ['grievance_id', 'idempotency_key']
    }
  ],
  validate: {
    checkLevels() {
      if (this.to_level !== this.from_level + 1) {
        throw new Error('to_level must equal from_level + 1');
      }
    },
    checkManualOrAuto() {
      if (this.escalation_type === 'manual') {
        if (!this.escalated_by || !this.idempotency_key || !this.request_fingerprint) {
          throw new Error('Manual escalation requires escalated_by, idempotency_key, and request_fingerprint');
        }
      } else if (this.escalation_type === 'automatic') {
        if (this.escalated_by !== null || this.idempotency_key !== null || this.request_fingerprint !== null) {
          throw new Error('Automatic escalation requires escalated_by, idempotency_key, and request_fingerprint to be null');
        }
      }
    }
  }
});

module.exports = GrievanceEscalation;
