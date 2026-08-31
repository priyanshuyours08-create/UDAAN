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

const Grievance = require('./Grievance');
const GrievanceEscalation = require('./GrievanceEscalation');

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

// Priority 5: Grievance Redressal
ApplicantProfile.hasMany(Grievance, { foreignKey: 'applicant_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
Grievance.belongsTo(ApplicantProfile, { foreignKey: 'applicant_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

Application.hasMany(Grievance, { foreignKey: 'application_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
Grievance.belongsTo(Application, { foreignKey: 'application_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

User.hasMany(Grievance, { as: 'AssignedGrievances', foreignKey: 'assigned_to', onDelete: 'SET NULL', onUpdate: 'CASCADE' });
Grievance.belongsTo(User, { as: 'Assignee', foreignKey: 'assigned_to', onDelete: 'SET NULL', onUpdate: 'CASCADE' });

User.hasMany(Grievance, { as: 'ClassifiedGrievances', foreignKey: 'classified_by', onDelete: 'SET NULL', onUpdate: 'CASCADE' });
Grievance.belongsTo(User, { as: 'Classifier', foreignKey: 'classified_by', onDelete: 'SET NULL', onUpdate: 'CASCADE' });

Grievance.hasMany(GrievanceEscalation, { as: 'Escalations', foreignKey: 'grievance_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
GrievanceEscalation.belongsTo(Grievance, { foreignKey: 'grievance_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

User.hasMany(GrievanceEscalation, { as: 'GrievanceEscalations', foreignKey: 'escalated_by', onDelete: 'SET NULL', onUpdate: 'CASCADE' });
GrievanceEscalation.belongsTo(User, { as: 'Actor', foreignKey: 'escalated_by', onDelete: 'SET NULL', onUpdate: 'CASCADE' });

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
  Grievance,
  GrievanceEscalation,
};
