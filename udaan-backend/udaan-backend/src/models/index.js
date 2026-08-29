const sequelize = require('../config/database');
const User = require('./User');
const ApplicantProfile = require('./ApplicantProfile');
const ApprovalRule = require('./ApprovalRule');
const Application = require('./Application');
const DocumentVault = require('./DocumentVault');
const Scheme = require('./Scheme');

User.hasOne(ApplicantProfile, { foreignKey: 'user_id' });
ApplicantProfile.belongsTo(User, { foreignKey: 'user_id' });

ApplicantProfile.hasMany(Application, { foreignKey: 'applicant_id' });
Application.belongsTo(ApplicantProfile, { foreignKey: 'applicant_id' });

ApprovalRule.hasMany(Application, { foreignKey: 'approval_rule_id' });
Application.belongsTo(ApprovalRule, { foreignKey: 'approval_rule_id' });

ApplicantProfile.hasMany(DocumentVault, { foreignKey: 'applicant_id' });
DocumentVault.belongsTo(ApplicantProfile, { foreignKey: 'applicant_id' });

module.exports = {
  sequelize,
  User,
  ApplicantProfile,
  ApprovalRule,
  Application,
  DocumentVault,
  Scheme,
};
