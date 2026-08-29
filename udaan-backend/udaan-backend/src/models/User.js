const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  password_hash: { type: DataTypes.STRING, allowNull: false },
  role: {
    type: DataTypes.ENUM('applicant', 'officer', 'inspector', 'admin'),
    defaultValue: 'applicant',
  },
  department: {
    type: DataTypes.STRING,
    allowNull: true,
  },
});

module.exports = User;
