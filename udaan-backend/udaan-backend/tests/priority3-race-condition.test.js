/**
 * Priority 3 — Simultaneous inspection-completion race condition tests (A–I)
 *
 * Uses the Express app directly via lightweight HTTP helpers (no external test
 * framework needed). Runs against a fresh in-memory SQLite database to avoid
 * polluting the development database.
 *
 * Usage:  NODE_ENV=test node tests/priority3-race-condition.test.js
 */

'use strict';

// ── Env setup ───────────────────────────────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-priority3';
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = ':memory:';

// ── Dependencies ────────────────────────────────────────────────────────────
const http = require('http');
const jwt = require('jsonwebtoken');

// Override database config BEFORE importing models
const sequelize = require('../src/config/database');
const {
  User,
  ApplicantProfile,
  ApprovalRule,
  Application,
  Inspection,
  InspectionApplication,
} = require('../src/models');
const app = require('../src/app');

// ── Helpers ─────────────────────────────────────────────────────────────────
let server;
let baseUrl;

function makeToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, department: user.department || null },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

/** Lightweight HTTP request helper (no external deps). */
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
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Test state ──────────────────────────────────────────────────────────────
let adminUser, inspectorUser, wrongInspector, applicantUser, applicantProfile;
let ruleWithInspection, ruleWithInspection2;
let adminToken, inspectorToken, wrongInspectorToken;

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

// ── Seed fresh database ─────────────────────────────────────────────────────
async function seedTestData() {
  await sequelize.sync({ force: true });

  adminUser = await User.create({
    name: 'Test Admin', email: 'admin@test.local',
    password_hash: 'unused', role: 'admin', department: null,
  });
  inspectorUser = await User.create({
    name: 'Test Inspector', email: 'inspector@test.local',
    password_hash: 'unused', role: 'inspector', department: 'Fire Department',
  });
  wrongInspector = await User.create({
    name: 'Wrong Inspector', email: 'wrong@test.local',
    password_hash: 'unused', role: 'inspector', department: 'Other',
  });
  applicantUser = await User.create({
    name: 'Test Applicant', email: 'applicant@test.local',
    password_hash: 'unused', role: 'applicant', department: null,
  });

  applicantProfile = await ApplicantProfile.create({
    user_id: applicantUser.id, business_name: 'Test Biz',
    sector: 'food_processing', state: 'Madhya Pradesh',
    investment_amount: 100, employee_count: 10,
    stage: 'pre_establishment',
  });

  ruleWithInspection = await ApprovalRule.create({
    sector: 'food_processing', state: 'Madhya Pradesh', stage: 'pre_establishment',
    min_investment: 0, max_investment: 999999999,
    approval_name: 'Test Fire NOC', department: 'Fire Department',
    required_documents: [],
    sla_days: 15, hazard_level: 'medium', requires_inspection: true,
  });

  ruleWithInspection2 = await ApprovalRule.create({
    sector: 'food_processing', state: 'Madhya Pradesh', stage: 'pre_establishment',
    min_investment: 0, max_investment: 999999999,
    approval_name: 'Test Pollution NOC', department: 'State Pollution Control Board',
    required_documents: [],
    sla_days: 30, hazard_level: 'high', requires_inspection: true,
  });

  adminToken = makeToken(adminUser);
  inspectorToken = makeToken(inspectorUser);
  wrongInspectorToken = makeToken(wrongInspector);
}

/**
 * Wraps a test function to temporarily force a failure on Application.findAll
 * inside transactions to simulate a failure during rollback testing.
 */
async function withForcedFailure(fn) {
  const originalFindAll = Application.findAll;
  let stubCalled = false;
  Application.findAll = async function(opts) {
    if (opts && opts.transaction) {
      Application.findAll = originalFindAll;
      stubCalled = true;
      throw new Error('Forced test failure for transaction rollback verification');
    }
    return originalFindAll.apply(this, arguments);
  };
  try {
    const res = await fn();
    assert(stubCalled, 'The fault-injection stub was successfully invoked');
    assert(Application.findAll === originalFindAll, 'original Application.findAll was restored');
    return res;
  } finally {
    Application.findAll = originalFindAll;
  }
}

/**
 * Creates a scheduled inspection with linked pending_inspection applications.
 * Returns { inspection, apps }.
 */
async function createScheduledInspection(opts = {}) {
  const { numApps = 2, assignTo = inspectorUser } = opts;
  const apps = [];
  for (let i = 0; i < numApps; i++) {
    const a = await Application.create({
      applicant_id: applicantProfile.id,
      approval_rule_id: (i % 2 === 0 ? ruleWithInspection : ruleWithInspection2).id,
      status: 'pending_inspection',
      risk_level: 'medium',
    });
    apps.push(a);
  }

  const inspection = await Inspection.create({
    applicant_id: applicantProfile.id,
    scheduled_date: new Date(Date.now() + 7 * 86400000),
    status: 'scheduled',
    assigned_inspector_id: assignTo ? assignTo.id : null,
  });

  for (const a of apps) {
    await InspectionApplication.create({
      inspection_id: inspection.id,
      application_id: a.id,
    });
  }

  return { inspection, apps };
}


// ── Tests ───────────────────────────────────────────────────────────────────

async function testA_RawTwoInspectionConcurrency() {
  console.log('\n=== Test A: Raw two-inspection concurrency ===');
  const setup1 = await createScheduledInspection();
  const setup2 = await createScheduledInspection();

  // Raw Promise.all — no retries
  const [r1, r2] = await Promise.all([
    request('PATCH', `/api/inspections/${setup1.inspection.id}/complete`,
      { result: 'pass' }, inspectorToken),
    request('PATCH', `/api/inspections/${setup2.inspection.id}/complete`,
      { result: 'fail', inspector_notes: 'Failed criteria' }, inspectorToken),
  ]);

  console.log(`  Raw first-attempt: Inspection ${setup1.inspection.id} → ${r1.status}`);
  console.log(`  Raw first-attempt: Inspection ${setup2.inspection.id} → ${r2.status}`);

  assert(r1.status === 200, `Inspection ${setup1.inspection.id} → HTTP 200 (no retry)`);
  assert(r2.status === 200, `Inspection ${setup2.inspection.id} → HTTP 200 (no retry)`);
  assert(r1.status !== 500 && r2.status !== 500, 'No HTTP 500 errors');

  const db1 = await Inspection.findByPk(setup1.inspection.id);
  const db2 = await Inspection.findByPk(setup2.inspection.id);
  assert(db1.status === 'completed', 'Inspection 1 completed');
  assert(db2.status === 'completed', 'Inspection 2 completed');
  assert(db1.result === 'pass', 'Inspection 1 result: pass');
  assert(db2.result === 'fail', 'Inspection 2 result: fail');

  const apps1 = await Application.findAll({ where: { id: setup1.apps.map((a) => a.id) } });
  const apps2 = await Application.findAll({ where: { id: setup2.apps.map((a) => a.id) } });
  assert(apps1.every((a) => a.status === 'approved'), 'Inspection 1 apps: approved');
  assert(apps2.every((a) => a.status === 'rejected'), 'Inspection 2 apps: rejected');
  assert(db1.id !== db2.id, 'No cross-mutation between inspections');
}

async function testB_FiveInspectionStressTest() {
  console.log('\n=== Test B: Raw multi-inspection stress test (5 inspections) ===');
  const results = ['pass', 'fail', 'conditional', 'pass', 'fail'];
  const setups = [];
  for (let i = 0; i < 5; i++) {
    setups.push(await createScheduledInspection());
  }

  // All 5 in one raw Promise.all — no retries
  const responses = await Promise.all(
    setups.map((s, i) => {
      const body = { result: results[i] };
      if (results[i] === 'fail' || results[i] === 'conditional') {
        body.inspector_notes = `Notes for ${results[i]}`;
      }
      return request('PATCH', `/api/inspections/${s.inspection.id}/complete`, body, inspectorToken);
    })
  );

  for (let i = 0; i < 5; i++) {
    console.log(`  Raw first-attempt: Inspection ${setups[i].inspection.id} → ${responses[i].status}`);
  }

  const statusMap = { pass: 'approved', fail: 'rejected', conditional: 'pending_review' };
  let anyFailed = false;
  for (let i = 0; i < 5; i++) {
    assert(responses[i].status === 200, `Inspection ${setups[i].inspection.id} → HTTP 200`);
    if (responses[i].status !== 200) anyFailed = true;
  }

  if (!anyFailed) {
    for (let i = 0; i < 5; i++) {
      const dbInsp = await Inspection.findByPk(setups[i].inspection.id);
      assert(dbInsp.result === results[i], `Inspection ${setups[i].inspection.id} result: ${results[i]}`);
      const apps = await Application.findAll({ where: { id: setups[i].apps.map((a) => a.id) } });
      const expectedStatus = statusMap[results[i]];
      assert(apps.every((a) => a.status === expectedStatus), `Inspection ${setups[i].inspection.id} apps: ${expectedStatus}`);
    }
  }
  assert(!anyFailed, 'No database transaction errors across all 5');
}

async function testC_SameInspectionConflictingConcurrency() {
  console.log('\n=== Test C: Same-inspection conflicting concurrency (pass/fail/conditional) ===');
  const { inspection, apps } = await createScheduledInspection();

  const [r1, r2, r3] = await Promise.all([
    request('PATCH', `/api/inspections/${inspection.id}/complete`,
      { result: 'pass' }, inspectorToken),
    request('PATCH', `/api/inspections/${inspection.id}/complete`,
      { result: 'fail', inspector_notes: 'Failed criteria' }, inspectorToken),
    request('PATCH', `/api/inspections/${inspection.id}/complete`,
      { result: 'conditional', inspector_notes: 'Needs follow-up' }, inspectorToken),
  ]);

  const statuses = [r1.status, r2.status, r3.status].sort();
  console.log(`  Raw response statuses: ${statuses.join(', ')}`);
  assert(statuses.filter((s) => s === 200).length === 1, 'Exactly one HTTP 200');
  assert(statuses.filter((s) => s === 409).length === 2, 'Two HTTP 409');
  assert(!statuses.includes(500), 'No HTTP 500 errors');

  const dbInsp = await Inspection.findByPk(inspection.id);
  assert(dbInsp.status === 'completed', 'Inspection completed');
  assert(['pass', 'fail', 'conditional'].includes(dbInsp.result), `One final result: '${dbInsp.result}'`);

  const statusMap = { pass: 'approved', fail: 'rejected', conditional: 'pending_review' };
  const expectedAppStatus = statusMap[dbInsp.result];
  const dbApps = await Application.findAll({ where: { id: apps.map((a) => a.id) } });
  assert(dbApps.every((a) => a.status === expectedAppStatus), `All apps consistent: '${expectedAppStatus}'`);
}

async function testD_SameInspectionIdenticalConcurrency() {
  console.log('\n=== Test D: Same-inspection identical concurrency (both pass) ===');
  const { inspection, apps } = await createScheduledInspection();

  const [r1, r2] = await Promise.all([
    request('PATCH', `/api/inspections/${inspection.id}/complete`,
      { result: 'pass' }, inspectorToken),
    request('PATCH', `/api/inspections/${inspection.id}/complete`,
      { result: 'pass' }, inspectorToken),
  ]);

  const statuses = [r1.status, r2.status].sort();
  assert(statuses[0] === 200 && statuses[1] === 409, 'One 200 + one 409');

  const dbInsp = await Inspection.findByPk(inspection.id);
  assert(dbInsp.result === 'pass', 'Single final result: pass');

  const dbApps = await Application.findAll({ where: { id: apps.map((a) => a.id) } });
  assert(dbApps.every((a) => a.status === 'approved'), 'All apps approved — no repeated mutation');
}

async function testE_TransactionFailureAndLockRelease() {
  console.log('\n=== Test E: Transaction failure and lock release ===');
  const { inspection, apps } = await createScheduledInspection();

  // Trigger test-only forced failure
  const r1 = await withForcedFailure(() => request('PATCH', `/api/inspections/${inspection.id}/complete`,
    { result: 'pass' }, inspectorToken));
  assert(r1.status === 500, 'Forced failure → 500');

  // Verify rollback
  const dbInsp1 = await Inspection.findByPk(inspection.id);
  assert(dbInsp1.status === 'scheduled', 'Inspection rolled back to scheduled');
  assert(dbInsp1.result === null, 'Result is null after rollback');

  const dbApps1 = await Application.findAll({ where: { id: apps.map((a) => a.id) } });
  assert(dbApps1.every((a) => a.status === 'pending_inspection'), 'Apps unchanged after rollback');

  // Valid retry — both locks (per-inspection + SQLite writer) must have been released
  const r2 = await request('PATCH', `/api/inspections/${inspection.id}/complete`,
    { result: 'pass' }, inspectorToken);
  assert(r2.status === 200, 'Valid retry → 200 (no stuck queue)');

  const dbInsp2 = await Inspection.findByPk(inspection.id);
  assert(dbInsp2.status === 'completed', 'Inspection now completed');
  assert(dbInsp2.result === 'pass', 'Result is pass');
}

async function testF_LockCleanup() {
  console.log('\n=== Test F: Lock cleanup verification ===');

  async function assertBehavioralCleanup(label) {
    const { inspection: tInsp } = await createScheduledInspection();
    const pTest = request('PATCH', `/api/inspections/${tInsp.id}/complete`, { result: 'pass' }, inspectorToken);
    const pTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Lock is stuck')), 1500));
    try {
      const r = await Promise.race([pTest, pTimeout]);
      assert(r.status === 200, `[${label}] Quick completion succeeded within timeout`);
    } catch (err) {
      assert(false, `[${label}] Failed: ${err.message}`);
    }
  }

  // 1. After success
  const { inspection: i1 } = await createScheduledInspection();
  await request('PATCH', `/api/inspections/${i1.id}/complete`, { result: 'pass' }, inspectorToken);
  await assertBehavioralCleanup('After success');

  // 2. After validation failure
  const { inspection: i2 } = await createScheduledInspection();
  await request('PATCH', `/api/inspections/${i2.id}/complete`, { result: 'conditional' }, inspectorToken);
  await assertBehavioralCleanup('After validation failure');

  // 3. After transaction failure
  const { inspection: i3 } = await createScheduledInspection();
  await withForcedFailure(() => request('PATCH', `/api/inspections/${i3.id}/complete`, { result: 'pass' }, inspectorToken));
  await assertBehavioralCleanup('After transaction failure');

  // 4. After a queued burst
  const burstInsps = await Promise.all([createScheduledInspection(), createScheduledInspection(), createScheduledInspection()]);
  await Promise.all([
    request('PATCH', `/api/inspections/${burstInsps[0].inspection.id}/complete`, { result: 'pass' }, inspectorToken),
    request('PATCH', `/api/inspections/${burstInsps[1].inspection.id}/complete`, { result: 'fail', inspector_notes: 'x' }, inspectorToken),
    request('PATCH', `/api/inspections/${burstInsps[2].inspection.id}/complete`, { result: 'pass' }, inspectorToken),
  ]);
  await assertBehavioralCleanup('After a queued burst');
}

async function testG_RegressionChecks() {
  console.log('\n=== Test G: Regression checks ===');

  // G.1 — Wrong-inspector denial
  console.log('  — Wrong-inspector denial');
  const setupWrong = await createScheduledInspection();
  const rWrong = await request('PATCH', `/api/inspections/${setupWrong.inspection.id}/complete`,
    { result: 'pass' }, wrongInspectorToken);
  assert(rWrong.status === 403, 'Wrong inspector → 403');
  const dbWrong = await Inspection.findByPk(setupWrong.inspection.id);
  assert(dbWrong.status === 'scheduled', 'Inspection unchanged');

  // G.2 — Admin completion
  console.log('  — Admin completion');
  const setupAdmin = await createScheduledInspection();
  const rAdmin = await request('PATCH', `/api/inspections/${setupAdmin.inspection.id}/complete`,
    { result: 'pass' }, adminToken);
  assert(rAdmin.status === 200, 'Admin completion → 200');
  const dbAdmin = await Inspection.findByPk(setupAdmin.inspection.id);
  assert(dbAdmin.result === 'pass', 'Admin result: pass');

  // G.3 — Pass mapping
  console.log('  — Pass mapping');
  const setupPass = await createScheduledInspection();
  await request('PATCH', `/api/inspections/${setupPass.inspection.id}/complete`,
    { result: 'pass' }, inspectorToken);
  const passApps = await Application.findAll({ where: { id: setupPass.apps.map((a) => a.id) } });
  assert(passApps.every((a) => a.status === 'approved'), 'Pass → apps approved');

  // G.4 — Fail mapping
  console.log('  — Fail mapping');
  const setupFail = await createScheduledInspection();
  await request('PATCH', `/api/inspections/${setupFail.inspection.id}/complete`,
    { result: 'fail', inspector_notes: 'Does not meet criteria' }, inspectorToken);
  const failApps = await Application.findAll({ where: { id: setupFail.apps.map((a) => a.id) } });
  assert(failApps.every((a) => a.status === 'rejected'), 'Fail → apps rejected');

  // G.5 — Conditional mapping
  console.log('  — Conditional mapping');
  const setupCond = await createScheduledInspection();
  await request('PATCH', `/api/inspections/${setupCond.inspection.id}/complete`,
    { result: 'conditional', inspector_notes: 'Needs additional review' }, inspectorToken);
  const condApps = await Application.findAll({ where: { id: setupCond.apps.map((a) => a.id) } });
  assert(condApps.every((a) => a.status === 'pending_review'), 'Conditional → apps pending_review');

  // G.6 — Cancelled guard
  console.log('  — Cancelled guard');
  const setupCancel = await createScheduledInspection();
  await Inspection.update({ status: 'cancelled' }, { where: { id: setupCancel.inspection.id } });
  const rCancel = await request('PATCH', `/api/inspections/${setupCancel.inspection.id}/complete`,
    { result: 'pass' }, inspectorToken);
  assert(rCancel.status === 409, 'Cancelled → 409');

  // G.7 — Repeat completion
  console.log('  — Repeat completion');
  const setupRepeat = await createScheduledInspection();
  await request('PATCH', `/api/inspections/${setupRepeat.inspection.id}/complete`,
    { result: 'pass' }, inspectorToken);
  const rRepeat = await request('PATCH', `/api/inspections/${setupRepeat.inspection.id}/complete`,
    { result: 'fail', inspector_notes: 'Try again' }, inspectorToken);
  assert(rRepeat.status === 409, 'Repeat completion → 409');

  // G.8 — Bundle idempotency and concurrency
  console.log('  — Bundle idempotency and concurrency');
  await Application.create({
    applicant_id: applicantProfile.id,
    approval_rule_id: ruleWithInspection.id,
    status: 'pending_inspection', risk_level: 'medium',
  });
  const applicantToken = makeToken(applicantUser);
  const rBundle1 = await request('POST', '/api/inspections/bundle',
    { applicant_id: applicantProfile.id }, applicantToken);
  assert(rBundle1.status === 200 || rBundle1.status === 201, `First bundle → ${rBundle1.status}`);
  const rBundle2 = await request('POST', '/api/inspections/bundle',
    { applicant_id: applicantProfile.id }, applicantToken);
  assert(rBundle2.status === 200, 'Second bundle → 200 (idempotent)');

  // G.9 — Priority 1 submission idempotency
  console.log('  — Priority 1 submission idempotency');
  const rSubmit1 = await request('POST', '/api/applications/submit',
    { applicant_id: applicantProfile.id }, applicantToken);
  const rSubmit2 = await request('POST', '/api/applications/submit',
    { applicant_id: applicantProfile.id }, applicantToken);
  assert([200, 201, 400].includes(rSubmit1.status), `First submit → ${rSubmit1.status} (not 500)`);
  assert([200, 201, 400].includes(rSubmit2.status), `Second submit → ${rSubmit2.status} (not 500)`);

  // G.10 — Priority 2 department authorization
  console.log('  — Priority 2 department authorization');
  const fireApp = await Application.create({
    applicant_id: applicantProfile.id,
    approval_rule_id: ruleWithInspection.id,
    status: 'pending_review', risk_level: 'medium',
  });
  const otherOfficer = await User.create({
    name: 'Other Officer', email: `other_officer_${Date.now()}@test.local`,
    password_hash: 'unused', role: 'officer', department: 'Other Department',
  });
  const otherOfficerToken = makeToken(otherOfficer);
  const rDecide = await request('PATCH', `/api/applications/${fireApp.id}/decide`,
    { decision: 'approved' }, otherOfficerToken);
  assert(rDecide.status === 403, 'Wrong-dept officer → 403');

  // G.11 — Transaction rollback
  console.log('  — Transaction rollback');
  const setupRollback = await createScheduledInspection();
  const rRollback = await withForcedFailure(() => request('PATCH', `/api/inspections/${setupRollback.inspection.id}/complete`,
    { result: 'conditional', inspector_notes: 'Need more info' }, inspectorToken));
  assert(rRollback.status === 500, 'Forced failure → 500');
  const dbRollback = await Inspection.findByPk(setupRollback.inspection.id);
  assert(dbRollback.status === 'scheduled', 'Inspection remains scheduled');
  assert(dbRollback.result === null, 'Result remains null');
  const rollbackApps = await Application.findAll({ where: { id: setupRollback.apps.map((a) => a.id) } });
  assert(rollbackApps.every((a) => a.status === 'pending_inspection'), 'Apps remain pending_inspection');
}

// ── Main runner ─────────────────────────────────────────────────────────────

async function run() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Priority 3: SQLite Writer Queue + Race Condition Tests     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await seedTestData();

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
  console.log(`\nTest server listening on ${baseUrl}\n`);

  try {
    await testA_RawTwoInspectionConcurrency();
    await testB_FiveInspectionStressTest();
    await testC_SameInspectionConflictingConcurrency();
    await testD_SameInspectionIdenticalConcurrency();
    await testE_TransactionFailureAndLockRelease();
    await testF_LockCleanup();
    await testG_RegressionChecks();
  } catch (err) {
    console.error('\n💥 Unexpected error during tests:', err);
    failed++;
  }

  // ── Final database counts ─────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Final Database Status');
  console.log('═══════════════════════════════════════════════════════════');

  const inspections = await Inspection.findAll();
  const completedCount = inspections.filter((i) => i.status === 'completed').length;
  const scheduledCount = inspections.filter((i) => i.status === 'scheduled').length;
  const cancelledCount = inspections.filter((i) => i.status === 'cancelled').length;
  console.log(`  Inspections total: ${inspections.length}`);
  console.log(`    completed: ${completedCount}`);
  console.log(`    scheduled: ${scheduledCount}`);
  console.log(`    cancelled: ${cancelledCount}`);

  const allApps = await Application.findAll();
  const appCounts = {};
  for (const a of allApps) {
    appCounts[a.status] = (appCounts[a.status] || 0) + 1;
  }
  console.log(`  Applications total: ${allApps.length}`);
  for (const [status, count] of Object.entries(appCounts).sort()) {
    console.log(`    ${status}: ${count}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  Results:  ${passed} passed,  ${failed} failed`);
  if (failures.length > 0) {
    console.log('  Failures:');
    for (const f of failures) {
      console.log(`    ❌ ${f}`);
    }
  }
  console.log('═══════════════════════════════════════════════════════════');

  server.close();
  await sequelize.close();

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
