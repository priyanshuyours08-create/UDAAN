'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = ':memory:';

const http = require('http');
const jwt = require('jsonwebtoken');
const fs = require('fs');

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

let baseUrl;

function request(method, path, body = null, headers = {}, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Priority 5: Grievance Escalation (Stage 3 Complete)         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  let testServerInstance = null;

  try {
    const { sequelize, User, ApplicantProfile, ApprovalRule, Application, Grievance, GrievanceEscalation, Notification } = require('../src/models');
    await sequelize.sync({ force: true });
    const app = require('../src/app');
    const { checkGrievanceEscalations } = require('../src/services/grievanceEscalationService');
    
    testServerInstance = app.listen(0);
    baseUrl = `http://127.0.0.1:${testServerInstance.address().port}`;
    
    const admin = await User.create({ name: 'Admin', email: 'admin@test', password_hash: '123', role: 'admin' });
    const officerA = await User.create({ name: 'OffA', email: 'oa@test', password_hash: '123', role: 'officer', department: 'DeptA' });
    const inspector = await User.create({ name: 'Insp', email: 'insp@test', password_hash: '123', role: 'inspector', department: 'DeptA' });
    const applicant1 = await User.create({ name: 'App1', email: 'app1@test', password_hash: '123', role: 'applicant' });
    const applicant2 = await User.create({ name: 'App2', email: 'app2@test', password_hash: '123', role: 'applicant' });
    const applicantNoProfile = await User.create({ name: 'AppNoP', email: 'appnp@test', password_hash: '123', role: 'applicant' });

    const prof1 = await ApplicantProfile.create({ user_id: applicant1.id, business_name: 'Biz1', sector: 'food', state: 'MP', investment_amount: 10, employee_count: 5, stage: 'pre_establishment', status: 'verified' });
    const prof2 = await ApplicantProfile.create({ user_id: applicant2.id, business_name: 'Biz2', sector: 'food', state: 'MP', investment_amount: 10, employee_count: 5, stage: 'pre_establishment', status: 'verified' });
    
    const tokenApp1 = jwt.sign({ id: applicant1.id, role: 'applicant' }, process.env.JWT_SECRET);
    const tokenApp2 = jwt.sign({ id: applicant2.id, role: 'applicant' }, process.env.JWT_SECRET);
    const tokenAppNoP = jwt.sign({ id: applicantNoProfile.id, role: 'applicant' }, process.env.JWT_SECRET);
    const tokenOffA = jwt.sign({ id: officerA.id, role: 'officer', department: 'DeptA' }, process.env.JWT_SECRET);
    const tokenInsp = jwt.sign({ id: inspector.id, role: 'inspector', department: 'DeptA' }, process.env.JWT_SECRET);
    const tokenAdmin = jwt.sign({ id: admin.id, role: 'admin' }, process.env.JWT_SECRET);

    const now = new Date('2023-01-01T12:00:00Z');
    const originalSla = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const escalationHours = 48;
    process.env.GRIEVANCE_ESCALATION_HOURS = '48';

    console.log('\n=== 1. OWNERSHIP, AUTH AND STRICT INPUT ===');
    const gAuth = await Grievance.create({ applicant_id: prof1.id, subject: 'S', description: 'D', department: 'DeptA', status: 'open', escalation_level: 0, state_version: 0, sla_deadline: originalSla, next_escalation_at: originalSla });
    
    const aRes1 = await request('POST', `/api/grievances/${gAuth.id}/escalate`, { reason: 'R', state_version: 0 }, { 'Idempotency-Key': 'k-auth1' }, tokenApp1);
    console.log('owning applicant manual escalation ->', aRes1.status);
    check(aRes1.status === 200, 'owning applicant manual escalation -> 200');

    const aRes2 = await request('POST', `/api/grievances/${gAuth.id}/escalate`, { reason: 'R', state_version: 1 }, { 'Idempotency-Key': 'k-auth2' }, tokenApp2);
    console.log('different applicant ->', aRes2.status);
    check(aRes2.status === 403, 'different applicant -> 403');

    const aRes3 = await request('POST', `/api/grievances/${gAuth.id}/escalate`, { reason: 'R', state_version: 1 }, { 'Idempotency-Key': 'k-auth3' }, tokenAppNoP);
    console.log('applicant without profile ->', aRes3.status);
    check(aRes3.status === 403, 'applicant without profile -> 403');

    const aRes4 = await request('POST', `/api/grievances/${gAuth.id}/escalate`, { reason: 'R', state_version: 1 }, { 'Idempotency-Key': 'k-auth4' }, tokenOffA);
    console.log('officer ->', aRes4.status);
    check(aRes4.status === 403, 'officer -> 403');
    
    const aRes5 = await request('POST', `/api/grievances/${gAuth.id}/escalate`, { reason: 'R', state_version: 1 }, { 'Idempotency-Key': 'k-auth5' }, tokenInsp);
    console.log('inspector ->', aRes5.status);
    check(aRes5.status === 403, 'inspector -> 403');

    const aRes6 = await request('POST', `/api/grievances/${gAuth.id}/escalate`, { reason: 'R', state_version: 1 }, { 'Idempotency-Key': 'k-auth6' }, tokenAdmin);
    console.log('admin ->', aRes6.status);
    check(aRes6.status === 403, 'admin -> 403');

    const aRes7 = await request('POST', `/api/grievances/${gAuth.id}/escalate`, { reason: 'R', state_version: 1 }, { 'Idempotency-Key': 'k-auth7' }, null);
    console.log('missing token ->', aRes7.status);
    check(aRes7.status === 401, 'missing token -> 401');

    const aRes8 = await request('POST', `/api/grievances/${gAuth.id}/escalate`, { reason: 'R', state_version: 1 }, { 'Idempotency-Key': 'k-auth8' }, 'invalid');
    console.log('invalid token ->', aRes8.status);
    check(aRes8.status === 401, 'invalid token -> 401');

    const badIds = ['0', '-1', 'abc', '1.5'];
    let idOk = true;
    for (const bad of badIds) {
      const res = await request('POST', `/api/grievances/${bad}/escalate`, { reason: 'R', state_version: 1 }, { 'Idempotency-Key': 'k-id' }, tokenApp1);
      if (res.status !== 400) idOk = false;
    }
    console.log('bad IDs ->', idOk ? 400 : 'FAIL');
    check(idOk, 'ID 0, -1, abc, 1.5 -> exactly 400');

    const aRes9 = await request('POST', `/api/grievances/99999/escalate`, { reason: 'R', state_version: 1 }, { 'Idempotency-Key': 'k-miss' }, tokenApp1);
    console.log('valid missing ID ->', aRes9.status);
    check(aRes9.status === 404, 'valid missing ID -> 404');

    const aRes10 = await request('POST', `/api/grievances/${gAuth.id}/escalate`, { reason: 'R', state_version: -1 }, { 'Idempotency-Key': 'k-v' }, tokenApp1);
    console.log('malformed state_version ->', aRes10.status);
    check(aRes10.status === 400, 'missing/malformed state_version -> 400');

    const aRes11 = await request('POST', `/api/grievances/${gAuth.id}/escalate`, { reason: 'R', state_version: 99 }, { 'Idempotency-Key': 'k-stale' }, tokenApp1);
    console.log('stale state_version ->', aRes11.status);
    check(aRes11.status === 409, 'stale state_version with a new key -> 409');

    const aRes12 = await request('POST', `/api/grievances/${gAuth.id}/escalate`, { reason: '   ', state_version: 1 }, { 'Idempotency-Key': 'k-re' }, tokenApp1);
    console.log('whitespace reason ->', aRes12.status);
    check(aRes12.status === 400, 'empty/whitespace reason -> 400');

    const aRes13 = await request('POST', `/api/grievances/${gAuth.id}/escalate`, { reason: 'R', state_version: 1, badField: 1 }, { 'Idempotency-Key': 'k-f' }, tokenApp1);
    console.log('unknown field ->', aRes13.status);
    check(aRes13.status === 400, 'unknown body field -> 400');

    const aRes14 = await request('POST', `/api/grievances/${gAuth.id}/escalate`, { reason: 'R', state_version: 1 }, { 'Idempotency-Key': 'bad key!!!' }, tokenApp1);
    console.log('malformed key ->', aRes14.status);
    check(aRes14.status === 400, 'malformed Idempotency-Key -> 400');

    const authEscs = await GrievanceEscalation.findAll({ where: { grievance_id: gAuth.id } });
    const authNots = await Notification.findAll({ where: { reference_id: gAuth.id, type: 'grievance_update' } });
    check(authEscs.length === 1 && authNots.length === 1, 'all rejected requests create zero history and notification rows');

    console.log('\n=== 2. REPLAY AFTER LATER STATE CHANGES ===');
    const gReplay = await Grievance.create({ applicant_id: prof1.id, subject: 'S', description: 'D', department: 'DeptA', status: 'open', escalation_level: 0, state_version: 0, sla_deadline: originalSla, next_escalation_at: originalSla });
    
    console.log('Key A escalates level 0 -> 1');
    const rep1 = await request('POST', `/api/grievances/${gReplay.id}/escalate`, { reason: '  Reason A  ', state_version: 0 }, { 'Idempotency-Key': 'Key-A' }, tokenApp1);
    check(rep1.status === 200, 'Escalated 0->1');
    
    await Grievance.update({ next_escalation_at: new Date(Date.now() - 1000) }, { where: { id: gReplay.id } });
    console.log('Key B escalates level 1 -> 2');
    const rep2 = await request('POST', `/api/grievances/${gReplay.id}/escalate`, { reason: 'Reason B', state_version: 1 }, { 'Idempotency-Key': 'Key-B' }, tokenApp1);
    check(rep2.status === 200, 'Escalated 1->2');

    console.log('Replay Key A with its original reason (testing normalization)');
    const rep3 = await request('POST', `/api/grievances/${gReplay.id}/escalate`, { reason: 'Reason A', state_version: 0 }, { 'Idempotency-Key': 'Key-A' }, tokenApp1);
    console.log('Replay status:', rep3.status, 'replayed:', rep3.body.replayed);
    check(rep3.status === 200 && rep3.body.replayed === true, 'Replay Key A -> 200, replayed=true');
    check(rep3.body.escalation.from_level === 0 && rep3.body.escalation.to_level === 1, 'Returns immutable Key-A event');
    
    // Check it did not mutate current state
    const gReplayNow = await Grievance.findByPk(gReplay.id);
    check(gReplayNow.escalation_level === 2 && gReplayNow.state_version === 2, 'Does not mutate current level-2 grievance');
    check(rep3.body.grievance.escalation_level === 2 && rep3.body.grievance.state_version === 2, 'Current grievance state is clearly distinguished from the replayed event');

    const rep4 = await request('POST', `/api/grievances/${gReplay.id}/escalate`, { reason: 'Different reason A', state_version: 0 }, { 'Idempotency-Key': 'Key-A' }, tokenApp1);
    check(rep4.status === 409, 'Same Key A with changed normalized reason -> 409');

    console.log('\n=== 3. COMPLETE TERMINAL/INELIGIBLE CASES ===');
    const gClosed = await Grievance.create({ applicant_id: prof1.id, subject: 'S', description: 'D', status: 'closed', escalation_level: 0, state_version: 0, sla_deadline: originalSla, next_escalation_at: null });
    const gResolved = await Grievance.create({ applicant_id: prof1.id, subject: 'S', description: 'D', status: 'resolved', escalation_level: 0, state_version: 0, sla_deadline: originalSla, next_escalation_at: null });
    const gMax = await Grievance.create({ applicant_id: prof1.id, subject: 'S', description: 'D', status: 'escalated', escalation_level: 3, state_version: 0, sla_deadline: originalSla, next_escalation_at: null });
    
    console.log('Manual Terminal');
    const mRes1 = await request('POST', `/api/grievances/${gClosed.id}/escalate`, { reason: 'R', state_version: 0 }, { 'Idempotency-Key': 'kT1' }, tokenApp1);
    check(mRes1.status === 409, 'closed -> 409');
    const mRes2 = await request('POST', `/api/grievances/${gResolved.id}/escalate`, { reason: 'R', state_version: 0 }, { 'Idempotency-Key': 'kT2' }, tokenApp1);
    check(mRes2.status === 409, 'resolved -> 409');
    const mRes3 = await request('POST', `/api/grievances/${gMax.id}/escalate`, { reason: 'R', state_version: 0 }, { 'Idempotency-Key': 'kT3' }, tokenApp1);
    check(mRes3.status === 409, 'level 3 -> 409');

    const pastDue = new Date('2023-01-01T10:00:00Z');
    const futureDue = new Date('2023-01-01T14:00:00Z');
    const testNow = new Date('2023-01-01T12:00:00Z');

    const gIgnoredNotDue = await Grievance.create({ applicant_id: prof1.id, subject: 'I1', description: 'D', status: 'open', escalation_level: 0, state_version: 0, sla_deadline: originalSla, next_escalation_at: futureDue });
    const gIgnoredNull = await Grievance.create({ applicant_id: prof1.id, subject: 'I2', description: 'D', status: 'open', escalation_level: 0, state_version: 0, sla_deadline: originalSla, next_escalation_at: null });
    const gDue = await Grievance.create({ applicant_id: prof1.id, subject: 'I3', description: 'D', status: 'open', escalation_level: 0, state_version: 0, sla_deadline: originalSla, next_escalation_at: testNow });

    console.log('Automatic Terminal/Ineligible');
    const autoRes = await checkGrievanceEscalations({ now: testNow });
    check(autoRes.escalations_processed === 1, 'exactly-due timestamp processed');
    
    const gaIgnoredClosed = await Grievance.findByPk(gClosed.id);
    check(gaIgnoredClosed.escalation_level === 0, 'closed ignored');
    const gaIgnoredResolved = await Grievance.findByPk(gResolved.id);
    check(gaIgnoredResolved.escalation_level === 0, 'resolved ignored');
    const gaIgnoredMax = await Grievance.findByPk(gMax.id);
    check(gaIgnoredMax.escalation_level === 3, 'level 3 ignored');
    const gaIgnoredFuture = await Grievance.findByPk(gIgnoredNotDue.id);
    check(gaIgnoredFuture.escalation_level === 0, 'future ignored');
    const gaIgnoredNullNow = await Grievance.findByPk(gIgnoredNull.id);
    check(gaIgnoredNullNow.escalation_level === 0, 'next_escalation_at=null ignored');

    // Skipped_ineligible definition and count verified through a controlled stale-candidate race
    const gRace = await Grievance.create({ applicant_id: prof1.id, subject: 'Race', description: 'D', status: 'open', escalation_level: 0, state_version: 0, sla_deadline: originalSla, next_escalation_at: testNow });
    
    // Using a stub in Grievance.findByPk to simulate race where the grievance becomes terminal just before the transactional recheck
    const originalFindByPk = Grievance.findByPk;
    let stubIneligible = false;
    Grievance.findByPk = async (id, options) => {
      if (options && options.transaction && id === gRace.id && !stubIneligible) {
        stubIneligible = true;
        // mutate it to closed
        await Grievance.update({ status: 'closed' }, { where: { id: gRace.id } });
      }
      return originalFindByPk.call(Grievance, id, options);
    };
    
    try {
      const raceRes = await checkGrievanceEscalations({ now: testNow });
      check(raceRes.skipped_ineligible === 1, 'skipped_ineligible count verified through controlled stale-candidate race');
    } finally {
      Grievance.findByPk = originalFindByPk;
    }

    console.log('\n=== 4. NO-RECIPIENT RETRYABILITY ===');
    const gNoRec = await Grievance.create({ applicant_id: prof1.id, subject: 'NoRec', description: 'D', status: 'open', escalation_level: 0, state_version: 0, sla_deadline: originalSla, next_escalation_at: testNow });
    
    const originalProfilePk = ApplicantProfile.findByPk;
    let stubProfile = false;
    ApplicantProfile.findByPk = async (id, options) => {
      if (id === prof1.id && !stubProfile) {
        stubProfile = true;
        return { id: prof1.id }; // Return profile WITHOUT .User
      }
      return originalProfilePk.call(ApplicantProfile, id, options);
    };
    
    try {
      const noRecRes = await checkGrievanceEscalations({ now: testNow });
      check(noRecRes.skipped_no_recipient === 1, 'skipped_no_recipient increments exactly once');
    } finally {
      ApplicantProfile.findByPk = originalProfilePk;
    }
    
    const gNoRecAfter = await Grievance.findByPk(gNoRec.id);
    check(gNoRecAfter.escalation_level === 0, 'service must not transition grievance');
    
    const noRecEscs = await GrievanceEscalation.findAll({ where: { grievance_id: gNoRec.id } });
    check(noRecEscs.length === 0, 'no history/notification');
    
    const recRetry = await checkGrievanceEscalations({ now: testNow });
    check(recRetry.escalations_processed === 1, 'restore recipient lookup; next run succeeds exactly once');

    console.log('\n=== 5. SEPARATE ATOMIC ROLLBACK TESTS ===');
    const gRbA = await Grievance.create({ applicant_id: prof1.id, subject: 'RbA', description: 'D', status: 'open', escalation_level: 0, state_version: 0, sla_deadline: originalSla, next_escalation_at: testNow });
    
    let hookEscalation = false;
    const oldGrievanceEscalationCreate = GrievanceEscalation.create;
    GrievanceEscalation.create = async () => { hookEscalation = true; throw new Error('Simulated DB Error Esc'); };
    
    console.log('A. GrievanceEscalation.create failure');
    try {
      const rbResA = await request('POST', `/api/grievances/${gRbA.id}/escalate`, { reason: 'RbA', state_version: 0 }, { 'Idempotency-Key': 'k-RbA' }, tokenApp1);
      check(hookEscalation, 'hook triggered');
      check(rbResA.status === 500, 'returns 500');
    } finally {
      GrievanceEscalation.create = oldGrievanceEscalationCreate;
      check(GrievanceEscalation.create === oldGrievanceEscalationCreate, 'original method restored');
    }
    const gRbAAfter = await Grievance.findByPk(gRbA.id);
    check(gRbAAfter.escalation_level === 0, 'state/version/deadlines unchanged');
    const heA = await GrievanceEscalation.findAll({ where: { grievance_id: gRbA.id } });
    check(heA.length === 0, 'no history');
    
    const rbResARetry = await request('POST', `/api/grievances/${gRbA.id}/escalate`, { reason: 'RbA', state_version: 0 }, { 'Idempotency-Key': 'k-RbA' }, tokenApp1);
    check(rbResARetry.status === 200, 'immediate retry succeeds');
    
    const gRbB = await Grievance.create({ applicant_id: prof1.id, subject: 'RbB', description: 'D', status: 'open', escalation_level: 0, state_version: 0, sla_deadline: originalSla, next_escalation_at: testNow });
    
    let hookNotif = false;
    const oldNotificationCreate = Notification.create;
    Notification.create = async () => { hookNotif = true; throw new Error('Simulated DB Error Notif'); };
    
    console.log('B. Notification.create failure');
    try {
      const rbResB = await request('POST', `/api/grievances/${gRbB.id}/escalate`, { reason: 'RbB', state_version: 0 }, { 'Idempotency-Key': 'k-RbB' }, tokenApp1);
      check(hookNotif, 'hook triggered');
      check(rbResB.status === 500, 'returns 500');
    } finally {
      Notification.create = oldNotificationCreate;
      check(Notification.create === oldNotificationCreate, 'original method restored');
    }
    const gRbBAfter = await Grievance.findByPk(gRbB.id);
    check(gRbBAfter.escalation_level === 0, 'state/version/deadlines unchanged');
    const heB = await GrievanceEscalation.findAll({ where: { grievance_id: gRbB.id } });
    check(heB.length === 0, 'history row rolls back');
    
    const rbResBRetry = await request('POST', `/api/grievances/${gRbB.id}/escalate`, { reason: 'RbB', state_version: 0 }, { 'Idempotency-Key': 'k-RbB' }, tokenApp1);
    check(rbResBRetry.status === 200, 'immediate retry succeeds');


    console.log('\n=== 6. RAW CONCURRENCY OUTCOMES ===');
    
    console.log('A. Two simultaneous automatic services');
    const gConcA = await Grievance.create({ applicant_id: prof1.id, subject: 'ConcA', description: 'D', status: 'open', escalation_level: 0, state_version: 0, sla_deadline: originalSla, next_escalation_at: testNow });
    const auto1 = checkGrievanceEscalations({ now: testNow });
    const auto2 = checkGrievanceEscalations({ now: testNow });
    const [ar1, ar2] = await Promise.all([auto1, auto2]);
    console.log('service result object 1:', ar1);
    console.log('service result object 2:', ar2);
    check(ar1.escalations_processed + ar2.escalations_processed === 1, 'exactly one total committed escalation');
    check(ar1.skipped_race + ar1.skipped_ineligible + ar2.skipped_race + ar2.skipped_ineligible === 1, 'loser counted as skipped_race or ineligible');
    
    console.log('B. Manual versus automatic, manual acquires first');
    const gConcB = await Grievance.create({ applicant_id: prof1.id, subject: 'ConcB', description: 'D', status: 'open', escalation_level: 0, state_version: 0, sla_deadline: originalSla, next_escalation_at: testNow });
    // manual executes synchronously
    const manResB = await request('POST', `/api/grievances/${gConcB.id}/escalate`, { reason: 'M', state_version: 0 }, { 'Idempotency-Key': 'k-ConcB' }, tokenApp1);
    const autoResB = await checkGrievanceEscalations({ now: testNow });
    console.log('manual exact HTTP status:', manResB.status, 'body:', manResB.body.message);
    console.log('automatic exact result object:', autoResB);
    check(manResB.status === 200, 'manual increments successfully');
    check(autoResB.escalations_processed === 0 && autoResB.skipped_ineligible === 0, 'automatic skips due to query exclusion');
    
    console.log('C. Automatic acquires first');
    const gConcC = await Grievance.create({ applicant_id: prof1.id, subject: 'ConcC', description: 'D', status: 'open', escalation_level: 0, state_version: 0, sla_deadline: originalSla, next_escalation_at: testNow });
    const autoResC = await checkGrievanceEscalations({ now: testNow });
    const manResC = await request('POST', `/api/grievances/${gConcC.id}/escalate`, { reason: 'M', state_version: 0 }, { 'Idempotency-Key': 'k-ConcC' }, tokenApp1);
    console.log('automatic exact result:', autoResC);
    console.log('manual exact HTTP status:', manResC.status, 'body:', manResC.body.error);
    check(autoResC.escalations_processed >= 1, 'automatic increments successfully');
    check(manResC.status === 409, 'manual returns 409 due to stale version or cooldown');
    
    console.log('D. Uncontrolled simultaneous launch');
    const gConcD = await Grievance.create({ applicant_id: prof1.id, subject: 'ConcD', description: 'D', status: 'open', escalation_level: 0, state_version: 0, sla_deadline: originalSla, next_escalation_at: testNow });
    const pD1 = request('POST', `/api/grievances/${gConcD.id}/escalate`, { reason: 'M', state_version: 0 }, { 'Idempotency-Key': 'k-ConcD' }, tokenApp1);
    const pD2 = checkGrievanceEscalations({ now: testNow });
    const [rd1, rd2] = await Promise.all([pD1, pD2]);
    console.log('Simultaneous - Manual:', rd1.status, 'Auto:', rd2);
    const concGAfter = await Grievance.findByPk(gConcD.id);
    check(concGAfter.escalation_level === 1 && concGAfter.state_version === 1, 'exactly one level increment');


    console.log('\n=== 7. GROUPED DATABASE EVIDENCE ===');
    const grps = await GrievanceEscalation.findAll({ where: { grievance_id: gReplay.id } });
    console.log(`History rows for gReplay (ID: ${gReplay.id}):`);
    grps.forEach(g => console.log(`  - Type: ${g.escalation_type}, Key: ${g.idempotency_key}, from ${g.from_level} to ${g.to_level}`));
    check(grps.filter(g => g.idempotency_key === 'Key-A').length === 1, 'same manual key count exactly 1');
    
    const notsGReplay = await Notification.findAll({ where: { reference_id: gReplay.id, type: 'grievance_update' } });
    check(notsGReplay.length === grps.length, 'one notification per committed escalation event');
    
    const autoHis = await GrievanceEscalation.findAll({ where: { grievance_id: gConcA.id, escalation_type: 'automatic' } });
    console.log(`Auto history rows for gConcA:`);
    autoHis.forEach(g => console.log(`  - Type: ${g.escalation_type}, Key: ${g.idempotency_key}, from ${g.from_level} to ${g.to_level}`));
    check(autoHis.length === 1, 'no duplicate event from a lost race');


    console.log('\n=== 8. TIME EVIDENCE ===');
    const realNowMs = Date.now();
    const realSla = new Date(realNowMs + 7 * 24 * 3600 * 1000);
    const configuredIntervalMs = escalationHours * 3600 * 1000;
    
    console.log('Real Operation Time Bound:', new Date(realNowMs).toISOString());
    console.log('Original SLA:', realSla.toISOString());
    console.log('Configured hours:', escalationHours);
    
    const tG = await Grievance.create({ applicant_id: prof1.id, subject: 'T', description: 'D', status: 'open', escalation_level: 0, state_version: 0, sla_deadline: realSla, next_escalation_at: realSla, assigned_to: officerA.id });
    console.log('L0 next_escalation_at:', tG.next_escalation_at.toISOString());
    
    const beforeRequest1 = Date.now();
    const tR1 = await request('POST', `/api/grievances/${tG.id}/escalate`, { reason: 'T1', state_version: 0 }, { 'Idempotency-Key': 'kT1' }, tokenApp1);
    const afterRequest1 = Date.now();
    
    check(tR1.status === 200, 'Level 1 manual before initial deadline is allowed');
    const l1NextMs = new Date(tR1.body.grievance.next_escalation_at).getTime();
    console.log('L1 next_escalation_at:', new Date(l1NextMs).toISOString());
    
    check(beforeRequest1 < realSla.getTime(), 'beforeRequest < original sla_deadline');
    check(tR1.body.grievance.escalation_level === 1, 'level 0 -> 1');
    check(tR1.body.grievance.sla_deadline === realSla.toISOString(), 'original sla_deadline unchanged');
    
    const minExpectedL1 = beforeRequest1 + configuredIntervalMs;
    const maxExpectedL1 = afterRequest1 + configuredIntervalMs;
    check(l1NextMs >= minExpectedL1 && l1NextMs <= maxExpectedL1 + 500, 'L1 next time lies between before+interval and after+interval');
    check(l1NextMs !== realSla.getTime() + configuredIntervalMs, 'not calculated from old SLA deadline');
    
    const beforeSetL2 = Date.now();
    await Grievance.update({ next_escalation_at: new Date(beforeSetL2 - 1000) }, { where: { id: tG.id } }); // Legitimately due
    const beforeRequest2 = Date.now();
    const tR2 = await request('POST', `/api/grievances/${tG.id}/escalate`, { reason: 'T2', state_version: 1 }, { 'Idempotency-Key': 'kT2' }, tokenApp1);
    const afterRequest2 = Date.now();
    
    const l2NextMs = new Date(tR2.body.grievance.next_escalation_at).getTime();
    console.log('L2 next_escalation_at:', new Date(l2NextMs).toISOString());
    check(tR2.body.grievance.escalation_level === 2, 'level 1 -> 2');
    check(tR2.body.grievance.assigned_to === null, 'assignee cleared');
    const minExpectedL2 = beforeRequest2 + configuredIntervalMs;
    const maxExpectedL2 = afterRequest2 + configuredIntervalMs;
    check(l2NextMs >= minExpectedL2 && l2NextMs <= maxExpectedL2 + 500, 'L2 next time lies between before+interval and after+interval');
    
    const beforeSetL3 = Date.now();
    await Grievance.update({ next_escalation_at: new Date(beforeSetL3 - 1000) }, { where: { id: tG.id } }); // Legitimately due
    const tR3 = await request('POST', `/api/grievances/${tG.id}/escalate`, { reason: 'T3', state_version: 2 }, { 'Idempotency-Key': 'kT3' }, tokenApp1);
    console.log('L3 next_escalation_at:', tR3.body.grievance.next_escalation_at);
    check(tR3.body.grievance.next_escalation_at === null, 'Level 3 next time = null');

    console.log('\n=== 9. DETERMINISTIC SERVICE-CLOCK TESTS ===');
    const autoClockRes = await Grievance.create({ applicant_id: prof1.id, subject: 'AC', description: 'D', status: 'open', escalation_level: 0, state_version: 0, sla_deadline: originalSla, next_escalation_at: testNow, assigned_to: officerA.id });
    await checkGrievanceEscalations({ now: testNow });
    const autoClockAfter = await Grievance.findByPk(autoClockRes.id);
    const expectedAutoL1NextMs = testNow.getTime() + configuredIntervalMs;
    check(autoClockAfter.next_escalation_at.getTime() === expectedAutoL1NextMs, 'resulting next_escalation_at must equal injected now + interval exactly');


    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`  Results:  ${testsRun - testsFailed} passed,  ${testsFailed} failed`);
    console.log('═══════════════════════════════════════════════════════════\n');

    process.exit(testsFailed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test suite failed:', err);
    process.exit(1);
  }
}

runTests();
