require('dotenv').config();
const bcrypt = require('bcryptjs');
const { sequelize, User, ApprovalRule, Scheme } = require('../models');

const approvalRules = [
  // ---- Food Processing sector, Madhya Pradesh, pre-establishment ----
  {
    sector: 'food_processing', state: 'Madhya Pradesh', stage: 'pre_establishment',
    min_investment: 0, max_investment: 999999999,
    approval_name: 'Udyam Registration', department: 'MSME Department',
    required_documents: ['Aadhaar', 'PAN', 'Business Address Proof'],
    sla_days: 3, hazard_level: 'low', requires_inspection: false,
  },
  {
    sector: 'food_processing', state: 'Madhya Pradesh', stage: 'pre_establishment',
    min_investment: 0, max_investment: 999999999,
    approval_name: 'Factory License', department: 'Labour Department',
    required_documents: ['Site Plan', 'Ownership/Lease Proof', 'Udyam Certificate'],
    sla_days: 20, hazard_level: 'medium', requires_inspection: true,
  },
  {
    sector: 'food_processing', state: 'Madhya Pradesh', stage: 'pre_establishment',
    min_investment: 50, max_investment: 999999999,
    approval_name: 'Pollution Control Consent to Establish', department: 'State Pollution Control Board',
    required_documents: ['Site Plan', 'Project Report', 'Effluent Treatment Plan'],
    sla_days: 30, hazard_level: 'high', requires_inspection: true,
  },
  {
    sector: 'food_processing', state: 'Madhya Pradesh', stage: 'pre_establishment',
    min_investment: 0, max_investment: 999999999,
    approval_name: 'Fire NOC', department: 'Fire Department',
    required_documents: ['Building Plan', 'Fire Safety Layout'],
    sla_days: 15, hazard_level: 'medium', requires_inspection: true,
  },
  {
    sector: 'food_processing', state: 'Madhya Pradesh', stage: 'pre_establishment',
    min_investment: 0, max_investment: 999999999,
    approval_name: 'FSSAI License', department: 'Food Safety Department',
    required_documents: ['Water Test Report', 'Layout Plan', 'List of Directors'],
    sla_days: 25, hazard_level: 'medium', requires_inspection: true,
  },

  // ---- Food Processing sector, operational stage (renewals/ongoing) ----
  {
    sector: 'food_processing', state: 'Madhya Pradesh', stage: 'operational',
    min_investment: 0, max_investment: 999999999,
    approval_name: 'Pollution Control Consent to Operate', department: 'State Pollution Control Board',
    required_documents: ['Consent to Establish Copy', 'Compliance Report'],
    sla_days: 20, hazard_level: 'high', requires_inspection: true,
  },
  {
    sector: 'food_processing', state: 'Madhya Pradesh', stage: 'operational',
    min_investment: 0, max_investment: 999999999,
    approval_name: 'Labour Welfare Registration', department: 'Labour Department',
    required_documents: ['Employee List', 'Wage Register'],
    sla_days: 10, hazard_level: 'low', requires_inspection: false,
  },

  // ---- Textile Manufacturing sector, Madhya Pradesh ----
  {
    sector: 'textile', state: 'Madhya Pradesh', stage: 'pre_establishment',
    min_investment: 0, max_investment: 999999999,
    approval_name: 'Udyam Registration', department: 'MSME Department',
    required_documents: ['Aadhaar', 'PAN', 'Business Address Proof'],
    sla_days: 3, hazard_level: 'low', requires_inspection: false,
  },
  {
    sector: 'textile', state: 'Madhya Pradesh', stage: 'pre_establishment',
    min_investment: 0, max_investment: 999999999,
    approval_name: 'Factory License', department: 'Labour Department',
    required_documents: ['Site Plan', 'Ownership/Lease Proof'],
    sla_days: 20, hazard_level: 'medium', requires_inspection: true,
  },
  {
    sector: 'textile', state: 'Madhya Pradesh', stage: 'pre_establishment',
    min_investment: 100, max_investment: 999999999,
    approval_name: 'Pollution Control Consent to Establish', department: 'State Pollution Control Board',
    required_documents: ['Site Plan', 'Effluent Treatment Plan', 'Project Report'],
    sla_days: 30, hazard_level: 'high', requires_inspection: true,
  },
  {
    sector: 'textile', state: 'Madhya Pradesh', stage: 'pre_establishment',
    min_investment: 0, max_investment: 999999999,
    approval_name: 'Fire NOC', department: 'Fire Department',
    required_documents: ['Building Plan', 'Fire Safety Layout'],
    sla_days: 15, hazard_level: 'medium', requires_inspection: true,
  },
  {
    sector: 'textile', state: 'Madhya Pradesh', stage: 'pre_establishment',
    min_investment: 0, max_investment: 999999999,
    approval_name: 'Electricity Load Sanction', department: 'State Electricity Board',
    required_documents: ['Load Requirement Certificate', 'Site Plan'],
    sla_days: 15, hazard_level: 'low', requires_inspection: false,
  },

  // ---- Applies to ALL sectors/states (common baseline approvals) ----
  {
    sector: 'all', state: 'all', stage: 'pre_establishment',
    min_investment: 0, max_investment: 999999999,
    approval_name: 'GST Registration', department: 'GST Department',
    required_documents: ['PAN', 'Business Address Proof', 'Bank Account Details'],
    sla_days: 7, hazard_level: 'low', requires_inspection: false,
  },
  {
    sector: 'all', state: 'all', stage: 'renewal',
    min_investment: 0, max_investment: 999999999,
    approval_name: 'Annual Compliance Renewal', department: 'District Industries Centre',
    required_documents: ['Previous Year Compliance Report'],
    sla_days: 10, hazard_level: 'low', requires_inspection: false,
  },
];

const schemes = [
  {
    name: 'MP Industrial Investment Promotion Scheme',
    description: 'Capital subsidy for new manufacturing units in Madhya Pradesh.',
    sector: 'all', state: 'Madhya Pradesh',
    min_investment: 25, max_investment: 999999999, min_employees: 0,
    benefit_description: 'Up to 30% capital subsidy on eligible fixed capital investment.',
  },
  {
    name: 'PMEGP (Prime Minister Employment Generation Programme)',
    description: 'Central credit-linked subsidy scheme for new micro-enterprises.',
    sector: 'all', state: 'all',
    min_investment: 0, max_investment: 50, min_employees: 0,
    benefit_description: 'Margin money subsidy of 15-35% of project cost.',
  },
  {
    name: 'Food Processing Industries Scheme (PLISFPI)',
    description: 'Production-linked incentive for food processing units.',
    sector: 'food_processing', state: 'all',
    min_investment: 10, max_investment: 999999999, min_employees: 0,
    benefit_description: 'Incentive linked to incremental sales of processed food products.',
  },
  {
    name: 'Technology Upgradation Fund Scheme (TUFS) - Textiles',
    description: 'Interest subsidy for technology upgradation in textile units.',
    sector: 'textile', state: 'all',
    min_investment: 20, max_investment: 999999999, min_employees: 0,
    benefit_description: '5% interest reimbursement on term loans for machinery upgrade.',
  },
  {
    name: 'Stamp Duty Exemption - MP Industrial Policy',
    description: 'Exemption on stamp duty for land/building registration for new industrial units.',
    sector: 'all', state: 'Madhya Pradesh',
    min_investment: 0, max_investment: 999999999, min_employees: 0,
    benefit_description: '50-100% exemption on stamp duty depending on zone classification.',
  },
  {
    name: 'Employment Generation Subsidy',
    description: 'Subsidy for units generating significant local employment.',
    sector: 'all', state: 'all',
    min_investment: 0, max_investment: 999999999, min_employees: 50,
    benefit_description: 'Reimbursement of employer EPF contribution for 3 years.',
  },
];

const seedUsers = [
  {
    name: 'Fire Officer',
    email: 'fire_officer@test.com',
    password_hash: bcrypt.hashSync('password123', 10),
    role: 'officer',
    department: 'Fire Department',
  },
  {
    name: 'Pollution Control Officer',
    email: 'pcb_officer@test.com',
    password_hash: bcrypt.hashSync('password123', 10),
    role: 'officer',
    department: 'State Pollution Control Board',
  },
  {
    name: 'Null Dept Officer',
    email: 'null_dept_officer@test.com',
    password_hash: bcrypt.hashSync('password123', 10),
    role: 'officer',
    department: null,
  },
  {
    name: 'Fire Inspector',
    email: 'fire_inspector@test.com',
    password_hash: bcrypt.hashSync('password123', 10),
    role: 'inspector',
    department: 'Fire Department',
  },
  {
    name: 'System Admin',
    email: 'admin@test.com',
    password_hash: bcrypt.hashSync('password123', 10),
    role: 'admin',
    department: null,
  },
  {
    name: 'Test Applicant',
    email: 'applicant@test.com',
    password_hash: bcrypt.hashSync('password123', 10),
    role: 'applicant',
    department: null,
  },
];

async function seed() {
  await sequelize.sync({ force: true }); // WARNING: drops and recreates all tables
  await User.bulkCreate(seedUsers);
  await ApprovalRule.bulkCreate(approvalRules);
  await Scheme.bulkCreate(schemes);
  console.log(`Seeded ${seedUsers.length} users, ${approvalRules.length} approval rules, and ${schemes.length} schemes.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
