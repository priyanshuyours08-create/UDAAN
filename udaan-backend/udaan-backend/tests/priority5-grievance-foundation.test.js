'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = ':memory:';

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');

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
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Priority 5: Grievance Foundation (Stage 1)                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  let testServerInstance = null;

  try {
    const { sequelize, User, ApplicantProfile, ApprovalRule, Application, Grievance, GrievanceEscalation } = require('../src/models');
    await sequelize.sync({ force: true });
    const app = require('../src/app');
    
    testServerInstance = app.listen(0);
    baseUrl = `http://127.0.0.1:${testServerInstance.address().port}`;
    
    // Seed test users
    const applicantUser1 = await User.create({ name: 'A', email: 'app1@test.local', password_hash: '123', role: 'applicant' });
    const applicantUser2 = await User.create({ name: 'A', email: 'app2@test.local', password_hash: '123', role: 'applicant' });
    const officerUser = await User.create({ name: 'O', email: 'officer@test.local', password_hash: '123', role: 'officer', department: 'DeptA' });
    
    const profile1 = await ApplicantProfile.create({ user_id: applicantUser1.id, business_name: 'Comp1', sector: 'food', state: 'MP', investment_amount: 10, employee_count: 5, stage: 'pre_establishment', status: 'verified' });
    const profile2 = await ApplicantProfile.create({ user_id: applicantUser2.id, business_name: 'Comp2', sector: 'food', state: 'MP', investment_amount: 10, employee_count: 5, stage: 'pre_establishment', status: 'verified' });
    
    const rule1 = await ApprovalRule.create({
      sector: 'all', state: 'all', approval_name: 'Rule1', department: 'DeptA', required_documents: []
    });
    const ruleEmpty = await ApprovalRule.create({
      sector: 'all', state: 'all', approval_name: 'RuleEmpty', department: '', required_documents: []
    });
    
    const app1 = await Application.create({
      applicant_id: profile1.id, approval_rule_id: rule1.id, status: 'submitted', sla_deadline: new Date()
    });
    const app2 = await Application.create({
      applicant_id: profile2.id, approval_rule_id: rule1.id, status: 'submitted', sla_deadline: new Date()
    });
    const appEmpty = await Application.create({
      applicant_id: profile1.id, approval_rule_id: ruleEmpty.id, status: 'submitted', sla_deadline: new Date()
    });

    const token1 = jwt.sign({ id: applicantUser1.id, role: 'applicant' }, process.env.JWT_SECRET);
    const token2 = jwt.sign({ id: applicantUser2.id, role: 'applicant' }, process.env.JWT_SECRET);
    const tokenOfficer = jwt.sign({ id: officerUser.id, role: 'officer', department: 'DeptA' }, process.env.JWT_SECRET);

    // A. Model/schema validation
    console.log('=== A. Model/schema ===');
    const dbIndexes = await sequelize.query('PRAGMA index_list(Grievances)');
    const indexNames = dbIndexes[0].map(i => i.name);
    check(indexNames.includes('idx_grievance_applicant_createdAt'), 'idx_grievance_applicant_createdAt exists');
    check(indexNames.includes('idx_grievance_assigned_status'), 'idx_grievance_assigned_status exists');
    check(indexNames.includes('idx_grievance_dept_status_assigned'), 'idx_grievance_dept_status_assigned exists');
    check(indexNames.includes('idx_grievance_status_deadlines_level'), 'idx_grievance_status_deadlines_level exists');
    check(indexNames.includes('idx_grievance_application_id'), 'idx_grievance_application_id exists');
    
    const escIndexes = await sequelize.query('PRAGMA index_list(GrievanceEscalations)');
    const escIndexNames = escIndexes[0].map(i => i.name);
    check(escIndexNames.includes('idx_grievance_escalation_createdAt'), 'idx_grievance_escalation_createdAt exists');
    check(escIndexNames.includes('uq_grievance_idempotency'), 'uq_grievance_idempotency exists');
    
    const fks = await sequelize.query('PRAGMA foreign_key_list(Grievances)');
    const fksList = Array.isArray(fks) ? (fks[0] && typeof fks[0] === 'object' && 'table' in fks[0] ? fks : fks[0]) : [];
    const fkRules = fksList.map(fk => ({ to: fk.table, onDelete: fk.on_delete }));
    check(fkRules.some(r => r.to === 'ApplicantProfiles' && r.onDelete === 'RESTRICT'), 'ApplicantProfile FK is RESTRICT');
    check(fkRules.some(r => r.to === 'Applications' && r.onDelete === 'RESTRICT'), 'Application FK is RESTRICT');
    check(fkRules.some(r => r.to === 'Users' && r.onDelete === 'SET NULL'), 'User FKs are SET NULL');

    const aliases = Object.keys(Grievance.associations);
    check(aliases.includes('ApplicantProfile'), 'ApplicantProfile association exists');
    check(aliases.includes('Application'), 'Application association exists');
    check(aliases.includes('Assignee'), 'Assignee association exists');
    check(aliases.includes('Classifier'), 'Classifier association exists');
    check(aliases.includes('Escalations'), 'Escalations association exists');

    let validationErr = null;
    try {
      await GrievanceEscalation.build({ grievance_id: 1, from_level: 1, to_level: 3, escalation_type: 'manual' }).validate();
    } catch(e) { validationErr = e.message; }
    check(validationErr && validationErr.includes('to_level must equal from_level + 1'), 'Escalation model blocks invalid level jump');

    // B. Create unlinked grievance
    console.log('\n=== B. Create unlinked grievance ===');
    const resUnlinked = await request('POST', '/api/grievances', {
        subject: 'General Complaint',
        description: 'Testing unlinked',
        status: 'resolved',
        department: 'HackedDept'
      }, token1);
    
    check(resUnlinked.status === 400, 'Privileged fields (status, department) rejected with 400');

    const resUnlinked2 = await request('POST', '/api/grievances', {
        subject: 'General Complaint',
        description: 'Testing unlinked'
      }, token1);
    check(resUnlinked2.status === 201, 'Created unlinked grievance');
    check(resUnlinked2.body.department === null, 'department is null');
    check(resUnlinked2.body.assigned_to === null, 'assignment is null');
    check(resUnlinked2.body.status === 'open', 'status is open');
    check(resUnlinked2.body.next_escalation_at === resUnlinked2.body.sla_deadline, 'next_escalation_at equals sla_deadline');
    const unlinkedGrievanceId = resUnlinked2.body.id;

    // C. Linked grievance
    console.log('\n=== C. Linked grievance ===');
    const resLinked = await request('POST', '/api/grievances', {
        subject: 'App issue',
        description: 'Desc',
        application_id: app1.id,
        department: 'FakeDept'
      }, token1);
    check(resLinked.status === 400, 'Privileged department rejected');

    const resLinked2 = await request('POST', '/api/grievances', {
        subject: 'App issue',
        description: 'Desc',
        application_id: app1.id
      }, token1);
    check(resLinked2.status === 201, 'Created linked grievance');
    check(resLinked2.body.department === 'DeptA', 'department derived from ApprovalRule');
    
    const resCrossApp = await request('POST', '/api/grievances', { subject: 'Test', description: 'Desc', application_id: app2.id }, token1);
    check(resCrossApp.status === 403, 'Cross-applicant application rejected with 403');
    
    const resMissApp = await request('POST', '/api/grievances', { subject: 'Test', description: 'Desc', application_id: 9999 }, token1);
    check(resMissApp.status === 404, 'Missing application rejected with 404');
    
    const resEmptyDept = await request('POST', '/api/grievances', { subject: 'Test', description: 'Desc', application_id: appEmpty.id }, token1);
    check(resEmptyDept.status === 409, 'Application with empty rule department rejected with 409');

    // D. Validation
    console.log('\n=== D. Validation ===');
    const resVal1 = await request('POST', '/api/grievances', { subject: '', description: 'Desc' }, token1);
    check(resVal1.status === 400, 'Empty subject rejected');
    const resVal2 = await request('POST', '/api/grievances', { subject: 'Subj', description: '' }, token1);
    check(resVal2.status === 400, 'Empty description rejected');
    const resVal3 = await request('POST', '/api/grievances', { subject: 'Subj', description: 'Desc', priority: 'invalid' }, token1);
    check(resVal3.status === 400, 'Invalid priority rejected');
    const resVal4 = await request('POST', '/api/grievances', { subject: 'Subj', description: 'Desc', application_id: -5 }, token1);
    check(resVal4.status === 400, 'Negative application_id rejected');
    const resVal5 = await request('POST', '/api/grievances', { subject: 'Subj', description: 'Desc' }, null);
    check(resVal5.status === 401, 'Missing token rejected');
    const resVal6 = await request('POST', '/api/grievances', { subject: 'Subj', description: 'Desc' }, tokenOfficer);
    check(resVal6.status === 403, 'Officer (wrong role) rejected with 403');

    // E. Mine ownership
    console.log('\n=== E. Mine ownership ===');
    const resMine = await request('GET', '/api/grievances/mine', null, token1);
    check(resMine.status === 200, 'Fetched mine successfully');
    check(resMine.body.grievances.length === 2, 'Returns only own grievances');
    check(resMine.body.grievances[0].id > resMine.body.grievances[1].id, 'Newest first deterministic ordering');
    check(resMine.body.pagination.total === 2, 'Pagination metadata exists');
    
    const resMine2 = await request('GET', '/api/grievances/mine', null, token2);
    check(resMine2.status === 200 && resMine2.body.grievances.length === 0, 'No cross-applicant leakage (empty collection)');
    
    const resMineOfficer = await request('GET', '/api/grievances/mine', null, tokenOfficer);
    check(resMineOfficer.status === 403, 'Missing profile / wrong role returns 403');
    
    const resMinePag1 = await request('GET', '/api/grievances/mine?page=-1', null, token1);
    check(resMinePag1.status === 400, 'Invalid pagination page rejected with 400');

    // F. Transaction rollback
    console.log('\n=== F. Transaction rollback ===');
    let dbCount1 = await Grievance.count();
    let hookExecuted = false;
    
    const oldCreate = Grievance.create;
    Grievance.create = async () => { hookExecuted = true; throw new Error('Simulated DB Error'); };
    
    const resRollback = await request('POST', '/api/grievances', { subject: 'Rollback', description: 'Desc' }, token1);
    
    Grievance.create = oldCreate;
    
    check(hookExecuted === true, 'Simulated failure triggered');
    check(resRollback.status === 500, 'Transaction rolled back safely');
    let dbCount2 = await Grievance.count();
    check(dbCount1 === dbCount2, 'Zero new grievance rows remain');
    
    const resRetry = await request('POST', '/api/grievances', { subject: 'Retry', description: 'Desc' }, token1);
    check(resRetry.status === 201, 'Immediate valid retry succeeds (shared SQLite queue released)');

    // G. Concurrent creation
    console.log('\n=== G. Concurrent creation ===');
    const p1 = request('POST', '/api/grievances', { subject: 'Conc1', description: 'Desc' }, token1);
    const p2 = request('POST', '/api/grievances', { subject: 'Conc2', description: 'Desc' }, token1);
    const [resP1, resP2] = await Promise.all([p1, p2]);
    check(resP1.status === 201 && resP2.status === 201, 'Two independent grievances both created cleanly concurrently');

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`  Results:  ${testsRun - testsFailed} passed,  ${testsFailed} failed`);
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('Test suite failed:', err);
    testsFailed++;
  } finally {
    if (testServerInstance) {
      testServerInstance.close();
    }
    process.exit(testsFailed > 0 ? 1 : 0);
  }
}

runTests();
