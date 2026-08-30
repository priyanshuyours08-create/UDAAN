/**
 * Stage 1: Shared SQLite Write Lock Concurrency Tests
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-priority4';
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = ':memory:';

const http = require('http');
const jwt = require('jsonwebtoken');

const sequelize = require('../src/config/database');
const { User, ApplicantProfile, ApprovalRule, Application, Inspection, InspectionApplication, DocumentVault } = require('../src/models');
const app = require('../src/app');
const { withSqliteWriteLock } = require('../src/utils/sqliteWriteLock');

// Helpers
let server;
let baseUrl;

function makeToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, department: user.department || null },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(path, baseUrl);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let adminUser, adminToken;
let applicantUser1, applicantProfile1, applicantToken1;
let applicantUser2, applicantProfile2, applicantToken2;
let applicantUser3, applicantProfile3, applicantToken3;
let inspectorUser1, inspectorToken1;
let inspectorUser2, inspectorToken2;
let ruleWithInspection, ruleWithoutInspection;

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ❌ ${label}`);
  }
}

async function seedTestData() {
  await sequelize.sync({ force: true });

  adminUser = await User.create({ name: 'Admin', email: 'admin@t.local', password_hash: 'x', role: 'admin' });
  adminToken = makeToken(adminUser);

  applicantUser1 = await User.create({ name: 'App1', email: 'a1@t.local', password_hash: 'x', role: 'applicant' });
  applicantProfile1 = await ApplicantProfile.create({ user_id: applicantUser1.id, business_name: 'C1', sector: 'Manufacturing', state: 'Delhi', investment_amount: 100, employee_count: 10 });
  applicantToken1 = makeToken(applicantUser1);

  applicantUser2 = await User.create({ name: 'App2', email: 'a2@t.local', password_hash: 'x', role: 'applicant' });
  applicantProfile2 = await ApplicantProfile.create({ user_id: applicantUser2.id, business_name: 'C2', sector: 'Manufacturing', state: 'Delhi', investment_amount: 100, employee_count: 10 });
  applicantToken2 = makeToken(applicantUser2);

  applicantUser3 = await User.create({ name: 'App3', email: 'a3@t.local', password_hash: 'x', role: 'applicant' });
  applicantProfile3 = await ApplicantProfile.create({ user_id: applicantUser3.id, business_name: 'C3', sector: 'Manufacturing', state: 'Delhi', investment_amount: 100, employee_count: 10 });
  applicantToken3 = makeToken(applicantUser3);

  inspectorUser1 = await User.create({ name: 'Insp1', email: 'i1@t.local', password_hash: 'x', role: 'inspector', department: 'Fire' });
  inspectorToken1 = makeToken(inspectorUser1);

  inspectorUser2 = await User.create({ name: 'Insp2', email: 'i2@t.local', password_hash: 'x', role: 'inspector', department: 'Water' });
  inspectorToken2 = makeToken(inspectorUser2);

  ruleWithInspection = await ApprovalRule.create({
    sector: 'Manufacturing', state: 'Delhi', approval_name: 'Fire NOC', department: 'Fire',
    requires_inspection: true, risk_category: 'high', sla_days: 14, required_documents: ['Id'],
  });

  ruleWithoutInspection = await ApprovalRule.create({
    sector: 'Manufacturing', state: 'Delhi', approval_name: 'Simple NOC', department: 'Fire',
    requires_inspection: false, risk_category: 'low', sla_days: 5, required_documents: ['Id'],
  });

  // Upload document for apps
  await DocumentVault.findOrCreate({ where: { applicant_id: applicantProfile1.id, document_type: 'Id' }, defaults: { file_url: 'http://t', verified_status: 'verified' } });
  
  await DocumentVault.findOrCreate({ where: { applicant_id: applicantProfile2.id, document_type: 'Id' }, defaults: { file_url: 'http://t', verified_status: 'verified' } });
  
  await DocumentVault.findOrCreate({ where: { applicant_id: applicantProfile3.id, document_type: 'Id' }, defaults: { file_url: 'http://t', verified_status: 'verified' } });
}

async function assertQueueClean(label) {
  // Behavioral check: Execute a lightweight transaction and prove it succeeds without timing out
  const timeoutMs = 1000;
  
  const pTest = request('POST', '/api/applications/submit', { applicant_id: applicantProfile1.id }, applicantToken1);
  const pTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Queue is stuck')), timeoutMs));
  
  try {
    const res = await Promise.race([pTest, pTimeout]);
    // The request should either succeed or fail with 400 (validation), but it MUST complete!
    assert(res.status === 200 || res.status === 201 || res.status === 400, `[${label}] Shared SQLite writer queue successfully released (behavioral timeout check)`);
  } catch (err) {
    assert(false, `[${label}] Queue is stuck! ${err.message}`);
  }
}

async function testA_SubmissionConcurrency() {
  console.log('\\n=== Test A: Submission concurrency ===');
  
  const [res1, res2] = await Promise.all([
    request('POST', '/api/applications/submit', { applicant_id: applicantProfile1.id }, applicantToken1),
    request('POST', '/api/applications/submit', { applicant_id: applicantProfile2.id }, applicantToken2)
  ]);

  if (res1.status !== 201 && res1.status !== 200) console.log('res1', res1.body);
  if (res2.status !== 201 && res2.status !== 200) console.log('res2', res2.body);

  assert(res1.status === 201 || res1.status === 200, `Applicant 1 submission HTTP ${res1.status}`);
  assert(res2.status === 201 || res2.status === 200, `Applicant 2 submission HTTP ${res2.status}`);

  const apps1 = await Application.count({ where: { applicant_id: applicantProfile1.id } });
  const apps2 = await Application.count({ where: { applicant_id: applicantProfile2.id } });
  
  assert(apps1 > 0, `Applicant 1 has ${apps1} apps`);
  assert(apps2 > 0, `Applicant 2 has ${apps2} apps`);

  await assertQueueClean('Test A');
}

async function testB_BundleConcurrency() {
  console.log('\\n=== Test B: Bundle concurrency ===');
  await Application.create({ applicant_id: applicantProfile1.id, approval_rule_id: ruleWithInspection.id, status: 'pending_inspection', risk_level: 'high', sla_deadline: new Date() });
  await Application.create({ applicant_id: applicantProfile2.id, approval_rule_id: ruleWithInspection.id, status: 'pending_inspection', risk_level: 'high', sla_deadline: new Date() });

  const [res1, res2] = await Promise.all([
    request('POST', '/api/inspections/bundle', { applicant_id: applicantProfile1.id }, applicantToken1),
    request('POST', '/api/inspections/bundle', { applicant_id: applicantProfile2.id }, applicantToken2)
  ]);

  assert(res1.status === 201 || res1.status === 200, `Applicant 1 bundle HTTP ${res1.status}`);
  assert(res2.status === 201 || res2.status === 200, `Applicant 2 bundle HTTP ${res2.status}`);

  await assertQueueClean('Test B');
}

async function testC_DifferentInspectionCompletionConcurrency() {
  console.log('\\n=== Test C: Different-inspection completion concurrency ===');
  const appC1 = await Application.create({ applicant_id: applicantProfile1.id, approval_rule_id: ruleWithInspection.id, status: 'pending_inspection', risk_level: 'high', sla_deadline: new Date() });
  const appC2 = await Application.create({ applicant_id: applicantProfile2.id, approval_rule_id: ruleWithInspection.id, status: 'pending_inspection', risk_level: 'high', sla_deadline: new Date() });
  
  const insp1 = await Inspection.create({ applicant_id: applicantProfile1.id, status: 'scheduled', assigned_inspector_id: inspectorUser1.id, scheduled_date: new Date() });
  const insp2 = await Inspection.create({ applicant_id: applicantProfile2.id, status: 'scheduled', assigned_inspector_id: inspectorUser2.id, scheduled_date: new Date() });

  await InspectionApplication.create({ inspection_id: insp1.id, application_id: appC1.id });
  await InspectionApplication.create({ inspection_id: insp2.id, application_id: appC2.id });

  const [res1, res2] = await Promise.all([
    request('PATCH', `/api/inspections/${insp1.id}/complete`, { result: 'pass' }, inspectorToken1),
    request('PATCH', `/api/inspections/${insp2.id}/complete`, { result: 'fail', inspector_notes: 'x' }, inspectorToken2)
  ]);

  assert(res1.status === 200, `Inspection 1 completion HTTP ${res1.status}`);
  assert(res2.status === 200, `Inspection 2 completion HTTP ${res2.status}`);

  const dbInsp1 = await Inspection.findByPk(insp1.id);
  const dbInsp2 = await Inspection.findByPk(insp2.id);
  assert(dbInsp1.result === 'pass', 'Inspection 1 passed');
  assert(dbInsp2.result === 'fail', 'Inspection 2 failed');

  await assertQueueClean('Test C');
}

async function testD_SameInspectionCompletionConcurrency() {
  console.log('\\n=== Test D: Same-inspection completion concurrency ===');
  await request('POST', '/api/applications/submit', { applicant_id: applicantProfile3.id }, applicantToken3);
  await Application.update({ status: 'pending_inspection' }, { where: { applicant_id: applicantProfile3.id } });
  await request('POST', '/api/inspections/bundle', { applicant_id: applicantProfile3.id }, applicantToken3);
  
  const insp = await Inspection.findOne({ where: { applicant_id: applicantProfile3.id, status: 'scheduled' } });
  await insp.update({ assigned_inspector_id: inspectorUser1.id });

  const [r1, r2, r3] = await Promise.all([
    request('PATCH', `/api/inspections/${insp.id}/complete`, { result: 'pass' }, inspectorToken1),
    request('PATCH', `/api/inspections/${insp.id}/complete`, { result: 'fail', inspector_notes: 'x' }, inspectorToken1),
    request('PATCH', `/api/inspections/${insp.id}/complete`, { result: 'conditional', inspector_notes: 'y' }, inspectorToken1)
  ]);

  const statuses = [r1.status, r2.status, r3.status].sort();
  assert(statuses[0] === 200 && statuses[1] === 409 && statuses[2] === 409, `Exactly one 200 and two 409s: ${statuses.join(', ')}`);

  await assertQueueClean('Test D');
}

async function testE_CrossControllerConcurrency() {
  console.log('\\n=== Test E: Cross-controller concurrency ===');
  // Create 3 new applicants for these concurrent ops
  const aSubmitUser = await User.create({ name: 'Sub', email: 's@t', password_hash: 'x', role: 'applicant' });
  const aSubmitProf = await ApplicantProfile.create({ user_id: aSubmitUser.id, business_name: 'S', sector: 'Manufacturing', state: 'Delhi', investment_amount: 100, employee_count: 10  });
  await DocumentVault.findOrCreate({ where: { applicant_id: aSubmitProf.id, document_type: 'Id' }, defaults: { file_url: 'http://t', verified_status: 'verified' } });
  const aSubmitToken = makeToken(aSubmitUser);

  const aBundleUser = await User.create({ name: 'Bun', email: 'b@t', password_hash: 'x', role: 'applicant' });
  const aBundleProf = await ApplicantProfile.create({ user_id: aBundleUser.id, business_name: 'B', sector: 'Manufacturing', state: 'Delhi', investment_amount: 100, employee_count: 10  });
  await DocumentVault.findOrCreate({ where: { applicant_id: aBundleProf.id, document_type: 'Id' }, defaults: { file_url: 'http://t', verified_status: 'verified' } });
  const aBundleToken = makeToken(aBundleUser);
  await request('POST', '/api/applications/submit', { applicant_id: aBundleProf.id }, aBundleToken);
  await Application.update({ status: 'pending_inspection' }, { where: { applicant_id: aBundleProf.id } });

  const aCompUser = await User.create({ name: 'Com', email: 'c@t', password_hash: 'x', role: 'applicant' });
  const aCompProf = await ApplicantProfile.create({ user_id: aCompUser.id, business_name: 'C', sector: 'Manufacturing', state: 'Delhi', investment_amount: 100, employee_count: 10  });
  await DocumentVault.findOrCreate({ where: { applicant_id: aCompProf.id, document_type: 'Id' }, defaults: { file_url: 'http://t', verified_status: 'verified' } });
  const aCompToken = makeToken(aCompUser);
  await request('POST', '/api/applications/submit', { applicant_id: aCompProf.id }, aCompToken);
  await Application.update({ status: 'pending_inspection' }, { where: { applicant_id: aCompProf.id } });
  await request('POST', '/api/inspections/bundle', { applicant_id: aCompProf.id }, aCompToken);
  const insp = await Inspection.findOne({ where: { applicant_id: aCompProf.id, status: 'scheduled' } });
  await insp.update({ assigned_inspector_id: inspectorUser1.id });

  const [resSubmit, resBundle, resComplete] = await Promise.all([
    request('POST', '/api/applications/submit', { applicant_id: aSubmitProf.id }, aSubmitToken),
    request('POST', '/api/inspections/bundle', { applicant_id: aBundleProf.id }, aBundleToken),
    request('PATCH', `/api/inspections/${insp.id}/complete`, { result: 'pass' }, inspectorToken1)
  ]);

  assert([200, 201].includes(resSubmit.status), `Submission HTTP ${resSubmit.status}`);
  assert([200, 201].includes(resBundle.status), `Bundle HTTP ${resBundle.status}`);
  assert(resComplete.status === 200, `Completion HTTP ${resComplete.status}`);

  await assertQueueClean('Test E');
}

async function testF_FailureAndQueueRelease() {
  console.log('\\n=== Test F: Failure and queue release ===');
  const aCompUser = await User.create({ name: 'Fail', email: 'f@t', password_hash: 'x', role: 'applicant' });
  const aCompProf = await ApplicantProfile.create({ user_id: aCompUser.id, business_name: 'F', sector: 'Manufacturing', state: 'Delhi', investment_amount: 100, employee_count: 10  });
  await DocumentVault.findOrCreate({ where: { applicant_id: aCompProf.id, document_type: 'Id' }, defaults: { file_url: 'http://t', verified_status: 'verified' } });
  const aCompToken = makeToken(aCompUser);
  await request('POST', '/api/applications/submit', { applicant_id: aCompProf.id }, aCompToken);
  await Application.update({ status: 'pending_inspection' }, { where: { applicant_id: aCompProf.id } });
  await request('POST', '/api/inspections/bundle', { applicant_id: aCompProf.id }, aCompToken);
  const insp = await Inspection.findOne({ where: { applicant_id: aCompProf.id, status: 'scheduled' } });
  await insp.update({ assigned_inspector_id: inspectorUser1.id });
  
  const resFail = await request('PATCH', `/api/inspections/${insp.id}/complete`, { result: 'pass', _force_failure: true }, inspectorToken1);
  assert(resFail.status === 500, `Forced failure HTTP 500 (got ${resFail.status})`);
  
  await assertQueueClean('Test F after error');

  const resRetry = await request('PATCH', `/api/inspections/${insp.id}/complete`, { result: 'pass' }, inspectorToken1);
  assert(resRetry.status === 200, `Valid retry after error HTTP 200 (got ${resRetry.status})`);

  await assertQueueClean('Test F after retry');
}

async function testJ_NonSqliteBypass() {
  console.log('\n=== Test J: Non-SQLite bypass ===');
  const mockSequelize = { getDialect: () => 'postgres' };
  
  const val = await withSqliteWriteLock(mockSequelize, async () => 'test_value');
  assert(val === 'test_value', 'Propagates resolved value');
  
  try {
    await withSqliteWriteLock(mockSequelize, async () => { throw new Error('test_error'); });
    assert(false, 'Should have thrown');
  } catch (err) {
    assert(err.message === 'test_error', 'Propagates error');
  }

  let lockReleased = false;
  const pSqliteLock = withSqliteWriteLock(sequelize, async () => {
    return new Promise(res => setTimeout(() => { lockReleased = true; res(); }, 500));
  });
  
  const bypassStart = Date.now();
  await withSqliteWriteLock(mockSequelize, async () => {});
  const bypassElapsed = Date.now() - bypassStart;
  
  assert(bypassElapsed < 100, 'Non-SQLite lock bypasses occupied SQLite queue immediately');
  assert(lockReleased === false, 'SQLite queue is still safely occupied');
  
  await pSqliteLock;
}

async function testRegressions() {
  console.log('\n=== Tests G, H, I: Regressions ===');
  // Simple check that previous tests still hold overall
  const resRepeat = await request('POST', '/api/applications/submit', { applicant_id: applicantProfile1.id }, applicantToken1);
  assert([200, 201].includes(resRepeat.status), `allow_resubmission preserved (HTTP ${resRepeat.status})`);

  const resUnauth = await request('PATCH', `/api/inspections/1/complete`, { result: 'pass' }, applicantToken1);
  assert(resUnauth.status === 403, 'Applicant blocked from inspection completion');
}

async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Stage 1: Shared SQLite Write Lock Concurrency Tests        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await seedTestData();

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
  console.log(`\\nTest server listening on ${baseUrl}\\n`);

  try {
    await testA_SubmissionConcurrency();
    await testB_BundleConcurrency();
    await testC_DifferentInspectionCompletionConcurrency();
    await testD_SameInspectionCompletionConcurrency();
    await testE_CrossControllerConcurrency();
    await testF_FailureAndQueueRelease();
    await testJ_NonSqliteBypass();
    await testRegressions();
  } catch (err) {
    console.error('\\n💥 Unexpected error during tests:', err);
    failed++;
  }

  // Final database counts
  const inspections = await Inspection.count();
  const applications = await Application.count();
  
  console.log('\\n═══════════════════════════════════════════════════════════');
  console.log(`  Database: ${inspections} inspections, ${applications} applications`);
  console.log(`  Results:  ${passed} passed,  ${failed} failed`);
  if (failures.length > 0) {
    console.log('  Failures:');
    for (const f of failures) console.log(`    ❌ ${f}`);
  }
  console.log('═══════════════════════════════════════════════════════════');

  server.close();
  await sequelize.close();

  return failed > 0 ? 1 : 0;
}

runTests().then((code) => process.exit(code)).catch((err) => {
  console.error(err);
  process.exit(1);
});
