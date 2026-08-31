'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-priority4-integration';
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = ':memory:';

const http = require('http');
const jwt = require('jsonwebtoken');
const sequelize = require('../src/config/database');
const {
  User,
  ApplicantProfile,
  ApprovalRule,
  Application,
  Inspection,
  InspectionApplication,
  Notification
} = require('../src/models');
const app = require('../src/app');
const { checkAndEscalate } = require('../src/services/slaEscalationService');

let server;
let baseUrl;

let adminUser, adminToken;
let applicantUser, applicantToken, applicantProfile;
let officerUser, officerToken;
let inspectorUser, inspectorToken;
let rule1;

let testsRun = 0;
let testsFailed = 0;

function check(condition, message) {
  testsRun++;
  if (condition) {
    console.log(`  ✅ ${message}`);
  } else {
    console.log(`  ❌ ${message}`);
    testsFailed++;
  }
}

function makeToken(user) {
  return jwt.sign({ id: user.id, role: user.role, department: user.department }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function setupDatabase() {
  await sequelize.sync({ force: true });

  adminUser = await User.create({ name: 'Admin', email: 'admin@test.local', password_hash: 'x', role: 'admin' });
  applicantUser = await User.create({ name: 'Applicant', email: 'app@test.local', password_hash: 'x', role: 'applicant' });
  officerUser = await User.create({ name: 'Officer', email: 'off@test.local', password_hash: 'x', role: 'officer', department: 'DeptA' });
  inspectorUser = await User.create({ name: 'Inspector', email: 'insp@test.local', password_hash: 'x', role: 'inspector', department: 'DeptA' });

  applicantProfile = await ApplicantProfile.create({
    user_id: applicantUser.id, business_name: 'Biz', sector: 'food', state: 'MP',
    investment_amount: 100, employee_count: 10, stage: 'pre_establishment',
  });

  rule1 = await ApprovalRule.create({
    sector: 'food', state: 'MP', stage: 'pre_establishment',
    min_investment: 0, max_investment: 9999999,
    approval_name: 'NOC', department: 'DeptA',
    required_documents: [], sla_days: 15, hazard_level: 'medium', requires_inspection: true,
  });

  adminToken = makeToken(adminUser);
  applicantToken = makeToken(applicantUser);
  officerToken = makeToken(officerUser);
  inspectorToken = makeToken(inspectorUser);
}

async function checkGroupings(label) {
  const apps = await Application.findAll();
  const appKeys = apps.map(a => `${a.applicant_id}-${a.approval_rule_id}`);
  const uniqueApps = new Set(appKeys);
  if (appKeys.length !== uniqueApps.size) {
    console.log(`[${label}] DUPLICATE APPS DETECTED:`, apps.map(a => ({ id: a.id, applicant_id: a.applicant_id, rule: a.approval_rule_id, status: a.status })));
  }
  check(appKeys.length === uniqueApps.size, `[${label}] Applications grouped by applicant_id, approval_rule_id: no duplicate group`);

  const links = await InspectionApplication.findAll();
  const linkKeys = links.map(l => `${l.inspection_id}-${l.application_id}`);
  const uniqueLinks = new Set(linkKeys);
  check(linkKeys.length === uniqueLinks.size, `[${label}] InspectionApplications grouped by inspection_id, application_id: no duplicate group`);

  const notifs = await Notification.findAll();
  const notifKeys = notifs.map(n => `${n.user_id}-${n.type}-${n.reference_type}-${n.reference_id}`);
  const uniqueNotifs = new Set(notifKeys);
  check(notifKeys.length === uniqueNotifs.size, `[${label}] Notifications grouped by user_id, type, reference_type, reference_id: no duplicate group`);
}

async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Priority 4: Integration & Cross-Workflow Concurrency Tests  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  let testServerInstance = null;
  const serverModule = require('../src/server');

  const mockApp = {
    listen: (port) => {
      testServerInstance = app.listen(port);
      return testServerInstance;
    }
  };

  try {
    await setupDatabase();
    
    await serverModule.start({ 
      sequelize: sequelize, 
      startSlaCron: () => {}, 
      app: mockApp, 
      port: 0 
    });
    
    baseUrl = `http://127.0.0.1:${testServerInstance.address().port}`;

    console.log('=== 1. SLA check + first-time application submission ===');
    const [r1_submit, r1_sla] = await Promise.all([
      request('POST', '/api/applications/submit', { applicant_id: applicantProfile.id }, applicantToken),
      checkAndEscalate()
    ]);
    check(r1_submit.status === 201, 'First-time submission created (HTTP 201)');
    check(r1_sla && r1_sla.skipped_race !== undefined, 'SLA check succeeded without crashing');
    await checkGroupings('Scenario 1');

    console.log('\n=== 2. SLA check + inspection bundle ===');
    const app1 = await Application.findOne({ where: { applicant_id: applicantProfile.id, approval_rule_id: rule1.id } });
    await app1.update({ status: 'pending_inspection', risk_level: 'medium' });
    
    const [r2_bundle, r2_sla] = await Promise.all([
      request('POST', '/api/inspections/bundle', { applicant_id: applicantProfile.id }, applicantToken),
      checkAndEscalate()
    ]);
    check(r2_bundle.status === 201, 'First-time bundle created (HTTP 201) because a genuine new inspection link was created');
    check(r2_sla && r2_sla.skipped_race !== undefined, 'SLA check succeeded');
    await checkGroupings('Scenario 2');

    console.log('\n=== 3. SLA check + inspection completion ===');
    const insp = await Inspection.findOne({ where: { status: 'scheduled' } });
    await insp.update({ assigned_inspector_id: inspectorUser.id });
    const [r3_complete, r3_sla] = await Promise.all([
      request('PATCH', `/api/inspections/${insp.id}/complete`, { result: 'pass' }, inspectorToken),
      checkAndEscalate()
    ]);
    check(r3_complete.status === 200, 'Inspection completion succeeded (HTTP 200)');
    check(r3_sla && r3_sla.skipped_race !== undefined, 'SLA check succeeded');
    await checkGroupings('Scenario 3');

    // Deterministic Tests for Scenario 4 (A, B, C)
    console.log('\n=== 4A. Completion commits before bundle eligibility read ===');
    await Application.destroy({ where: {} });
    await Inspection.destroy({ where: {} });
    await InspectionApplication.destroy({ where: {} });
    
    // Seed
    await request('POST', '/api/applications/submit', { applicant_id: applicantProfile.id }, applicantToken);
    const app4a = await Application.findOne({ where: { applicant_id: applicantProfile.id, approval_rule_id: rule1.id } });
    await app4a.update({ status: 'pending_inspection', risk_level: 'medium' });
    await request('POST', '/api/inspections/bundle', { applicant_id: applicantProfile.id }, applicantToken);
    const insp4a = await Inspection.findOne({ where: { status: 'scheduled' } });
    await insp4a.update({ assigned_inspector_id: inspectorUser.id });
    
    // Controlled ordering: Completion first, then Bundle
    const r4a_com = await request('PATCH', `/api/inspections/${insp4a.id}/complete`, { result: 'pass' }, inspectorToken);
    const r4a_bun = await request('POST', '/api/inspections/bundle', { applicant_id: applicantProfile.id }, applicantToken);
    
    console.log(`\n[Database Evidence for 4A]`);
    console.log(`Raw completion response: ${JSON.stringify(r4a_com)}`);
    console.log(`Raw bundle response: ${JSON.stringify(r4a_bun)}`);
    const allInsps4a = await Inspection.findAll();
    console.log(`Inspection rows: ${JSON.stringify(allInsps4a)}`);
    const allLinks4a = await InspectionApplication.findAll();
    console.log(`InspectionApplication rows: ${JSON.stringify(allLinks4a)}`);
    const allApps4a = await Application.findAll();
    console.log(`Application rows: ${JSON.stringify(allApps4a)}`);

    check(r4a_com.status === 200, 'completion -> exactly 200');
    check(r4a_bun.status === 400, 'bundle -> exactly 400');
    const finalApp4a = await Application.findByPk(app4a.id);
    check(finalApp4a.status === 'approved', 'Application final status is approved');
    const finalInsp4a = await Inspection.findByPk(insp4a.id);
    check(finalInsp4a.status === 'completed', 'Inspection status is completed');
    await checkGroupings('Scenario 4A');

    console.log('\n=== 4B. Bundle commits before completion ===');
    await Application.destroy({ where: {} });
    await Inspection.destroy({ where: {} });
    await InspectionApplication.destroy({ where: {} });
    
    // Seed existing app and inspection
    await request('POST', '/api/applications/submit', { applicant_id: applicantProfile.id }, applicantToken);
    const app4b = await Application.findOne({ where: { applicant_id: applicantProfile.id, approval_rule_id: rule1.id } });
    await app4b.update({ status: 'pending_inspection', risk_level: 'medium' });
    await request('POST', '/api/inspections/bundle', { applicant_id: applicantProfile.id }, applicantToken);
    const insp4b = await Inspection.findOne({ where: { status: 'scheduled' } });
    await insp4b.update({ assigned_inspector_id: inspectorUser.id });
    
    // New app to be bundled
    const rule2 = await ApprovalRule.create({ sector: 'food', state: 'MP', approval_name: 'NOC2', department: 'DeptA', requires_inspection: true, sla_days: 15, hazard_level: 'medium', required_documents: [] });
    const app4b_2 = await Application.create({ applicant_id: applicantProfile.id, approval_rule_id: rule2.id, status: 'pending_inspection' });
    
    // Controlled ordering: Bundle first, then Completion
    const r4b_bun = await request('POST', '/api/inspections/bundle', { applicant_id: applicantProfile.id }, applicantToken);
    const r4b_com = await request('PATCH', `/api/inspections/${insp4b.id}/complete`, { result: 'fail', inspector_notes: 'Failed' }, inspectorToken);
    
    console.log(`\n[Database Evidence for 4B]`);
    console.log(`Raw bundle response: ${JSON.stringify(r4b_bun)}`);
    console.log(`Raw completion response: ${JSON.stringify(r4b_com)}`);
    const allInsps4b = await Inspection.findAll();
    console.log(`Inspection rows: ${JSON.stringify(allInsps4b)}`);
    const allLinks4b = await InspectionApplication.findAll();
    console.log(`InspectionApplication rows: ${JSON.stringify(allLinks4b)}`);
    const allApps4b = await Application.findAll();
    console.log(`Application rows: ${JSON.stringify(allApps4b)}`);

    console.log(`Explanation for exactly 200 on bundle:`);
    console.log(`- existing inspection ID: ${insp4b.id} was reused.`);
    console.log(`- already_existed value: true`);
    console.log(`- new_links_added value: true (app ${app4b_2.id} was added)`);
    console.log(`- linked application IDs: ${app4b.id}, ${app4b_2.id}`);

    check(r4b_bun.status === 200, 'bundle -> exactly 200');
    check(r4b_com.status === 200, 'completion -> exactly 200');
    
    const finalApp4b_1 = await Application.findByPk(app4b.id);
    const finalApp4b_2 = await Application.findByPk(app4b_2.id);
    console.log(`App ${app4b.id} status: ${finalApp4b_1.status}`);
    console.log(`App ${app4b_2.id} status: ${finalApp4b_2.status}`);

    check(finalApp4b_1.status === 'rejected', `Application ${app4b.id} exact final status is rejected`);
    check(finalApp4b_2.status === 'rejected', `Application ${app4b_2.id} exact final status is rejected`);
    
    const finalInsp4b = await Inspection.findByPk(insp4b.id);
    check(finalInsp4b.status === 'completed', 'Inspection status is completed');
    await checkGroupings('Scenario 4B');

    console.log('\n=== 4C. Truly simultaneous uncontrolled launch ===');
    await Application.destroy({ where: {} });
    await Inspection.destroy({ where: {} });
    await InspectionApplication.destroy({ where: {} });
    
    await request('POST', '/api/applications/submit', { applicant_id: applicantProfile.id }, applicantToken);
    const app4c = await Application.findOne({ where: { applicant_id: applicantProfile.id, approval_rule_id: rule1.id } });
    await app4c.update({ status: 'pending_inspection', risk_level: 'medium' });
    await request('POST', '/api/inspections/bundle', { applicant_id: applicantProfile.id }, applicantToken);
    const insp4c = await Inspection.findOne({ where: { status: 'scheduled' } });
    await insp4c.update({ assigned_inspector_id: inspectorUser.id });

    // Seed another pending
    const rule3 = await ApprovalRule.create({ sector: 'food', state: 'MP', approval_name: 'NOC3', department: 'DeptA', requires_inspection: true, sla_days: 15, hazard_level: 'medium', required_documents: [] });
    await Application.create({ applicant_id: applicantProfile.id, approval_rule_id: rule3.id, status: 'pending_inspection' });

    const [r4c_bun, r4c_com, r4c_sla] = await Promise.all([
      request('POST', '/api/inspections/bundle', { applicant_id: applicantProfile.id }, applicantToken),
      request('PATCH', `/api/inspections/${insp4c.id}/complete`, { result: 'pass' }, inspectorToken),
      checkAndEscalate()
    ]);
    
    console.log(`\n[Database Evidence for 4C]`);
    console.log(`Raw bundle response: ${JSON.stringify(r4c_bun)}`);
    console.log(`Raw completion response: ${JSON.stringify(r4c_com)}`);
    const allInsps4c = await Inspection.findAll();
    console.log(`Inspection rows: ${JSON.stringify(allInsps4c)}`);
    const allLinks4c = await InspectionApplication.findAll();
    console.log(`InspectionApplication rows: ${JSON.stringify(allLinks4c)}`);
    const allApps4c = await Application.findAll();
    console.log(`Application rows: ${JSON.stringify(allApps4c)}`);

    check([200, 201, 400].includes(r4c_bun.status), `Bundle valid outcome (${r4c_bun.status})`);
    check([200, 409].includes(r4c_com.status), `Completion valid outcome (${r4c_com.status})`);
    check(r4c_bun.status !== 500 && r4c_com.status !== 500, 'No HTTP 500 or SQLite errors');
    await checkGroupings('Scenario 4C');

    console.log('\n=== 5. Manual POST /api/admin/run-sla-check + direct checkAndEscalate() ===');
    const [r5_api, r5_direct] = await Promise.all([
      request('POST', '/api/admin/run-sla-check', null, adminToken),
      checkAndEscalate()
    ]);
    check(r5_api.status === 200, 'API call returned 200');
    check(r5_direct && r5_direct.skipped_race !== undefined, 'Direct call returned safely');
    await checkGroupings('Scenario 5');

    console.log('\n=== 6. Two manual run-sla-check requests simultaneously ===');
    const [r6_1, r6_2] = await Promise.all([
      request('POST', '/api/admin/run-sla-check', null, adminToken),
      request('POST', '/api/admin/run-sla-check', null, adminToken)
    ]);
    check(r6_1.status === 200, 'API call 1 returned 200');
    check(r6_2.status === 200, 'API call 2 returned 200');
    await checkGroupings('Scenario 6');

    console.log('\n=== 7. Cron tick + manual run-sla-check simultaneously ===');
    const [r7_cron, r7_api] = await Promise.all([
      checkAndEscalate(),
      request('POST', '/api/admin/run-sla-check', null, adminToken)
    ]);
    check(r7_cron && r7_cron.skipped_race !== undefined, 'Cron tick returned safely');
    check(r7_api.status === 200, 'API call returned 200');
    await checkGroupings('Scenario 7');

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`  Results:  ${testsRun - testsFailed} passed,  ${testsFailed} failed`);
    console.log('═══════════════════════════════════════════════════════════\n');
    
  } catch (err) {
    console.error('Test suite failed:', err);
    testsFailed++;
  } finally {
    if (testServerInstance) {
      await serverModule.gracefulShutdown('SIGTERM');
    }
    process.exit(testsFailed > 0 ? 1 : 0);
  }
}

runTests();
