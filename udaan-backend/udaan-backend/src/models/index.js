const sequelize = require('../config/database');
const User = require('./User');
const ApplicantProfile = require('./ApplicantProfile');
const ApprovalRule = require('./ApprovalRule');
const Application = require('./Application');
const DocumentVault = require('./DocumentVault');
const Scheme = require('./Scheme');
const Inspection = require('./Inspection');
const InspectionApplication = require('./InspectionApplication');
const Notification = require('./Notification');

User.hasOne(ApplicantProfile, { foreignKey: 'user_id' });
ApplicantProfile.belongsTo(User, { foreignKey: 'user_id' });

ApplicantProfile.hasMany(Application, { foreignKey: 'applicant_id' });
Application.belongsTo(ApplicantProfile, { foreignKey: 'applicant_id' });

ApprovalRule.hasMany(Application, { foreignKey: 'approval_rule_id' });
Application.belongsTo(ApprovalRule, { foreignKey: 'approval_rule_id' });

ApplicantProfile.hasMany(DocumentVault, { foreignKey: 'applicant_id' });
DocumentVault.belongsTo(ApplicantProfile, { foreignKey: 'applicant_id' });

// Priority 3: Common Inspection Planner associations
Inspection.belongsTo(ApplicantProfile, { foreignKey: 'applicant_id' });
ApplicantProfile.hasMany(Inspection, { foreignKey: 'applicant_id' });

Inspection.belongsTo(User, { as: 'Inspector', foreignKey: 'assigned_inspector_id' });

Inspection.belongsToMany(Application, { through: InspectionApplication, foreignKey: 'inspection_id' });
Application.belongsToMany(Inspection, { through: InspectionApplication, foreignKey: 'application_id' });

Notification.belongsTo(User, {
  foreignKey: 'user_id',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

User.hasMany(Notification, {
  foreignKey: 'user_id'
});

module.exports = {
  sequelize,
  User,
  ApplicantProfile,
  ApprovalRule,
  Application,
  DocumentVault,
  Scheme,
  Inspection,
  InspectionApplication,
  Notification,
};
