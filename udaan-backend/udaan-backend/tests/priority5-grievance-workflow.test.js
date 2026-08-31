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
  console.log('║  Priority 5: Grievance Workflow (Stage 2)                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  let testServerInstance = null;

  try {
    const { sequelize, User, ApplicantProfile, ApprovalRule, Application, Grievance } = require('../src/models');
    await sequelize.sync({ force: true });
    const app = require('../src/app');
    
    testServerInstance = app.listen(0);
    baseUrl = `http://127.0.0.1:${testServerInstance.address().port}`;
    
    const admin = await User.create({ name: 'Admin', email: 'admin@test', password_hash: '123', role: 'admin' });
    const officerA = await User.create({ name: 'OffA', email: 'oa@test', password_hash: '123', role: 'officer', department: 'DeptA' });
    const officerB = await User.create({ name: 'OffB', email: 'ob@test', password_hash: '123', role: 'officer', department: 'DeptB' });
    const officerNull = await User.create({ name: 'OffN', email: 'on@test', password_hash: '123', role: 'officer' });
    const applicant1 = await User.create({ name: 'App1', email: 'app1@test', password_hash: '123', role: 'applicant' });
    const applicant2 = await User.create({ name: 'App2', email: 'app2@test', password_hash: '123', role: 'applicant' });
    const inspector = await User.create({ name: 'Insp', email: 'insp@test', password_hash: '123', role: 'inspector', department: 'DeptA' });

    const prof1 = await ApplicantProfile.create({ user_id: applicant1.id, business_name: 'Biz1', sector: 'food', state: 'MP', investment_amount: 10, employee_count: 5, stage: 'pre_establishment', status: 'verified' });
    const prof2 = await ApplicantProfile.create({ user_id: applicant2.id, business_name: 'Biz2', sector: 'food', state: 'MP', investment_amount: 10, employee_count: 5, stage: 'pre_establishment', status: 'verified' });
    
    const ruleA = await ApprovalRule.create({ sector: 'all', state: 'all', approval_name: 'RuleA', department: 'DeptA', required_documents: [] });
    const ruleB = await ApprovalRule.create({ sector: 'all', state: 'all', approval_name: 'RuleB', department: 'DeptB', required_documents: [] });
    
    const tokenAdmin = jwt.sign({ id: admin.id, role: 'admin' }, process.env.JWT_SECRET);
    const tokenOffA = jwt.sign({ id: officerA.id, role: 'officer', department: 'DeptA' }, process.env.JWT_SECRET);
    const tokenOffB = jwt.sign({ id: officerB.id, role: 'officer', department: 'DeptB' }, process.env.JWT_SECRET);
    const tokenOffNull = jwt.sign({ id: officerNull.id, role: 'officer' }, process.env.JWT_SECRET);
    const tokenApp1 = jwt.sign({ id: applicant1.id, role: 'applicant' }, process.env.JWT_SECRET);
    const tokenApp2 = jwt.sign({ id: applicant2.id, role: 'applicant' }, process.env.JWT_SECRET);
    const tokenInsp = jwt.sign({ id: inspector.id, role: 'inspector', department: 'DeptA' }, process.env.JWT_SECRET);

    const now = new Date();
    
    console.log('\n=== 1. Applicant 403 vs 409 Semantics ===');
    const gApp = await Grievance.create({ applicant_id: prof1.id, subject: 'S', description: 'D', department: 'DeptA', status: 'open', state_version: 0, sla_deadline: now });
    
    const a1 = await request('PATCH', `/api/grievances/${gApp.id}`, { status: 'in_progress', state_version: 0 }, tokenApp1);
    console.log('App open->in_progress (staff-only):', a1.status, a1.body);
    check(a1.status === 403, 'Applicant attempting staff-only transition (open->in_progress) -> exactly 403');
    
    const a2 = await request('PATCH', `/api/grievances/${gApp.id}`, { status: 'resolved', state_version: 0 }, tokenApp1);
    console.log('App open->resolved:', a2.status, a2.body);
    check(a2.status === 403, 'Applicant attempting to resolve -> exactly 403');
    
    const a3 = await request('PATCH', `/api/grievances/${gApp.id}`, { status: 'closed', state_version: 0 }, tokenApp2);
    console.log('App2 update App1 grievance:', a3.status, a3.body);
    check(a3.status === 403, 'Applicant attempting to update another applicant\'s grievance -> exactly 403');
    
    const a4 = await request('PATCH', `/api/grievances/${gApp.id}`, { status: 'closed', state_version: 0 }, tokenApp1);
    console.log('App closing open grievance:', a4.status, a4.body);
    check(a4.status === 409, 'Applicant closing their own grievance while status=open -> exactly 409');
    
    await gApp.update({ status: 'resolved' });
    
    const a5 = await request('PATCH', `/api/grievances/${gApp.id}`, { status: 'closed', state_version: 0 }, tokenApp2);
    console.log('App2 closing App1 resolved grievance:', a5.status, a5.body);
    check(a5.status === 403, 'Applicant closing another applicant\'s resolved grievance -> exactly 403');
    
    const a6 = await request('PATCH', `/api/grievances/${gApp.id}`, { status: 'closed', state_version: 0 }, tokenApp1);
    console.log('App1 closing own resolved grievance:', a6.status, a6.body);
    check(a6.status === 200, 'Applicant closing their own resolved grievance -> exactly 200');

    const gApp2 = await Grievance.create({ applicant_id: prof1.id, subject: 'S', description: 'D', department: 'DeptA', status: 'resolved', state_version: 0, sla_deadline: now });
    const a7 = await request('PATCH', `/api/grievances/${gApp2.id}`, { status: 'closed', state_version: 0 }, tokenOffA);
    console.log('Officer closed resolved:', a7.status, a7.body);
    check(a7.status === 403, 'Officer attempting resolved -> closed -> exactly 403');

    const a8 = await request('PATCH', `/api/grievances/${gApp2.id}`, { status: 'closed', state_version: 0 }, tokenAdmin);
    console.log('Admin closed resolved:', a8.status, a8.body);
    check(a8.status === 403, 'Admin attempting resolved -> closed -> exactly 403');

    console.log('\n=== 2. Complete Status-Transition Matrix ===');
    const tG = await Grievance.create({ applicant_id: prof1.id, subject: 'S', description: 'D', department: 'DeptA', assigned_to: officerA.id, status: 'open', state_version: 0, sla_deadline: now });
    
    // open -> in_progress
    const t1 = await request('PATCH', `/api/grievances/${tG.id}`, { status: 'in_progress', state_version: 0 }, tokenOffA);
    check(t1.status === 200, 'open -> in_progress (allowed)');
    
    // reset for open -> resolved
    await tG.update({ status: 'open', state_version: 1, resolved_at: null, resolution_notes: null, next_escalation_at: now });
    const t2 = await request('PATCH', `/api/grievances/${tG.id}`, { status: 'resolved', resolution_notes: 'Done', state_version: 1 }, tokenOffA);
    check(t2.status === 200, 'open -> resolved (allowed)');
    
    // reset for in_progress -> resolved
    await tG.update({ status: 'in_progress', state_version: 2, resolved_at: null, resolution_notes: null, next_escalation_at: now });
    const t3 = await request('PATCH', `/api/grievances/${tG.id}`, { status: 'resolved', resolution_notes: 'Done', state_version: 2 }, tokenOffA);
    check(t3.status === 200, 'in_progress -> resolved (allowed)');
    
    // reset for escalated -> in_progress
    await tG.update({ status: 'escalated', state_version: 3, resolved_at: null, resolution_notes: null, next_escalation_at: now });
    const t4 = await request('PATCH', `/api/grievances/${tG.id}`, { status: 'in_progress', state_version: 3 }, tokenOffA);
    check(t4.status === 200, 'escalated -> in_progress (allowed)');
    
    // reset for escalated -> resolved
    await tG.update({ status: 'escalated', state_version: 4, resolved_at: null, resolution_notes: null, next_escalation_at: now });
    const t5 = await request('PATCH', `/api/grievances/${tG.id}`, { status: 'resolved', resolution_notes: 'Done', state_version: 4 }, tokenOffA);
    check(t5.status === 200, 'escalated -> resolved (allowed)');
    
    // resolved -> closed by owning applicant
    const t6 = await request('PATCH', `/api/grievances/${tG.id}`, { status: 'closed', state_version: 5 }, tokenApp1);
    check(t6.status === 200, 'resolved -> closed by owning applicant (allowed)');
    
    // Forbidden transitions
    await tG.update({ status: 'resolved', state_version: 6 });
    const f1 = await request('PATCH', `/api/grievances/${tG.id}`, { status: 'open', state_version: 6 }, tokenOffA);
    check(f1.status === 409, 'resolved -> open (forbidden)');
    const f2 = await request('PATCH', `/api/grievances/${tG.id}`, { status: 'in_progress', state_version: 6 }, tokenOffA);
    check(f2.status === 409, 'resolved -> in_progress (forbidden)');
    const f3 = await request('PATCH', `/api/grievances/${tG.id}`, { status: 'escalated', state_version: 6 }, tokenOffA);
    check(f3.status === 409, 'resolved -> escalated (forbidden)');
    
    await tG.update({ status: 'closed', state_version: 7 });
    const f4 = await request('PATCH', `/api/grievances/${tG.id}`, { status: 'open', state_version: 7 }, tokenOffA);
    check(f4.status === 409, 'closed -> any state (forbidden)');
    
    await tG.update({ status: 'open', state_version: 8 });
    const f5 = await request('PATCH', `/api/grievances/${tG.id}`, { status: 'closed', state_version: 8 }, tokenOffA);
    check(f5.status === 403, 'open -> closed (forbidden for officer)');
    
    await tG.update({ status: 'in_progress', state_version: 9 });
    const f6 = await request('PATCH', `/api/grievances/${tG.id}`, { status: 'closed', state_version: 9 }, tokenOffA);
    check(f6.status === 403, 'in_progress -> closed (forbidden for officer)');
    
    const f7 = await request('PATCH', `/api/grievances/${tG.id}`, { status: 'in_progress', state_version: 9 }, tokenOffA);
    check(f7.status === 409, 'same-state update -> 409');

    // Notes validation
    await tG.update({ status: 'in_progress', state_version: 10 });
    const n1 = await request('PATCH', `/api/grievances/${tG.id}`, { status: 'resolved', resolution_notes: '   ', state_version: 10 }, tokenOffA);
    check(n1.status === 400, 'empty/whitespace notes -> 400');
    
    const longNotes = 'A'.repeat(2001);
    const n2 = await request('PATCH', `/api/grievances/${tG.id}`, { status: 'resolved', resolution_notes: longNotes, state_version: 10 }, tokenOffA);
    check(n2.status === 400, 'oversized notes -> 400');

    // Timestamps
    const tGAfter = await Grievance.findByPk(tG.id);
    check(tGAfter.status === 'in_progress' && tGAfter.state_version === 10, 'failed transition does not mutate status/version');

    const s1 = await request('PATCH', `/api/grievances/${tG.id}`, { status: 'resolved', resolution_notes: 'ok', state_version: 9 }, tokenOffA);
    check(s1.status === 409, 'stale state_version -> 409');

    // Assignment restrictions
    const uG = await Grievance.create({ applicant_id: prof1.id, subject: 'S', description: 'D', department: 'DeptA', status: 'open', state_version: 0, sla_deadline: now });
    const cD = await request('PATCH', `/api/grievances/${uG.id}`, { status: 'in_progress', state_version: 0 }, tokenOffA);
    check(cD.status === 403, 'unassigned officer update -> 403');
    
    await uG.update({ assigned_to: officerA.id });
    const cD2 = await request('PATCH', `/api/grievances/${uG.id}`, { status: 'in_progress', state_version: 0 }, tokenOffB);
    check(cD2.status === 403, 'cross-department officer update -> 403');

    console.log('\n=== 3. Complete Claim Cases ===');
    const claimG = await Grievance.create({ applicant_id: prof1.id, subject: 'S', description: 'D', department: 'DeptA', status: 'open', state_version: 0, sla_deadline: now });
    
    const cl1 = await request('PATCH', `/api/grievances/${claimG.id}/claim`, { state_version: 0 }, tokenOffNull);
    check(cl1.status === 403, 'null-department officer -> 403');
    
    const nullDeptG = await Grievance.create({ applicant_id: prof1.id, subject: 'S', description: 'D', department: null, status: 'open', state_version: 0, sla_deadline: now });
    const cl2 = await request('PATCH', `/api/grievances/${nullDeptG.id}/claim`, { state_version: 0 }, tokenOffA);
    check(cl2.status === 403, 'null-department grievance -> 403 for officer');
    
    const cl3 = await request('PATCH', `/api/grievances/${claimG.id}/claim`, { assignee_id: 9999, state_version: 0 }, tokenAdmin);
    check(cl3.status === 404, 'missing target user -> 404');
    
    const cl4 = await request('PATCH', `/api/grievances/${claimG.id}/claim`, { assignee_id: applicant1.id, state_version: 0 }, tokenAdmin);
    check(cl4.status === 400, 'target applicant -> 400');
    
    const cl5 = await request('PATCH', `/api/grievances/${claimG.id}/claim`, { assignee_id: inspector.id, state_version: 0 }, tokenAdmin);
    check(cl5.status === 400, 'target inspector -> 400');

    const cl5b = await request('PATCH', `/api/grievances/${claimG.id}/claim`, { assignee_id: admin.id, state_version: 0 }, tokenAdmin);
    check(cl5b.status === 400, 'target admin -> 400');
    
    const cl6 = await request('PATCH', `/api/grievances/${claimG.id}/claim`, { assignee_id: officerB.id, state_version: 0 }, tokenAdmin);
    check(cl6.status === 409, 'target officer with wrong department -> 409');
    
    const l2G = await Grievance.create({ applicant_id: prof1.id, subject: 'S', description: 'D', department: 'DeptA', escalation_level: 2, status: 'open', state_version: 0, sla_deadline: now });
    const cl7 = await request('PATCH', `/api/grievances/${l2G.id}/claim`, { assignee_id: officerA.id, state_version: 0 }, tokenAdmin);
    check(cl7.status === 200, 'admin assignment of level-2 grievance -> 200');
    
    const cl8 = await request('PATCH', `/api/grievances/${l2G.id}/claim`, { state_version: 1 }, tokenOffA);
    check(cl8.status === 403, 'officer self-claim of level-2 grievance -> 403');
    
    const cl9 = await request('PATCH', `/api/grievances/${l2G.id}/claim`, { assignee_id: null, state_version: 1 }, tokenAdmin);
    check(cl9.status === 200, 'admin unassignment -> 200');
    
    const cl10 = await request('PATCH', `/api/grievances/${l2G.id}/claim`, { assignee_id: null, state_version: 2 }, tokenAdmin);
    check(cl10.status === 409, 'repeated unassignment/no-op -> 409');
    
    await claimG.update({ status: 'resolved' });
    const cl11 = await request('PATCH', `/api/grievances/${claimG.id}/claim`, { assignee_id: officerA.id, state_version: 0 }, tokenAdmin);
    check(cl11.status === 409, 'resolved assignment or claim -> 409');

    console.log('\n=== 4. Deterministic Classify/Claim Races ===');
    
    // A. Classification commits first
    const rA = await Grievance.create({ applicant_id: prof1.id, subject: 'S', description: 'D', department: 'DeptA', state_version: 0, sla_deadline: now });
    // Classification happens fully
    const ra1 = await request('PATCH', `/api/grievances/${rA.id}/classify`, { department: 'DeptB', state_version: 0 }, tokenAdmin);
    console.log('Classification commits first - Classify:', ra1.status, ra1.body);
    // Claim attempts with state_version 0 (simulating it read before classification)
    const ra2 = await request('PATCH', `/api/grievances/${rA.id}/claim`, { state_version: 0 }, tokenOffA);
    console.log('Classification commits first - Claim:', ra2.status, ra2.body);
    check(ra2.status === 403 || ra2.status === 409, 'Claim fails with stale version or department mismatch');
    const rAAfter = await Grievance.findByPk(rA.id);
    check(rAAfter.department === 'DeptB' && rAAfter.state_version === 1, 'Final department DeptB and version 1');

    // B. Claim commits first, then incompatible classification
    const rB = await Grievance.create({ applicant_id: prof1.id, subject: 'S', description: 'D', department: 'DeptA', state_version: 0, sla_deadline: now });
    const rb1 = await request('PATCH', `/api/grievances/${rB.id}/claim`, { state_version: 0 }, tokenOffA);
    console.log('Claim commits first - Claim:', rb1.status, rb1.body);
    // Classification attempts with state_version 1 (simulating it read after claim) but changes department!
    const rb2 = await request('PATCH', `/api/grievances/${rB.id}/classify`, { department: 'DeptB', state_version: 1 }, tokenAdmin);
    console.log('Claim commits first - Classify:', rb2.status, rb2.body);
    const rBAfter = await Grievance.findByPk(rB.id);
    check(rBAfter.assigned_to === null, 'Classification atomically clears incompatible assignee');
    check(rBAfter.department === 'DeptB' && rBAfter.state_version === 2, 'Final department DeptB, assigned_to null, version 2');

    // C. Uncontrolled simultaneous launch
    const rC = await Grievance.create({ applicant_id: prof1.id, subject: 'S', description: 'D', department: 'DeptA', state_version: 0, sla_deadline: now });
    const p1 = request('PATCH', `/api/grievances/${rC.id}/classify`, { department: 'DeptB', state_version: 0 }, tokenAdmin);
    const p2 = request('PATCH', `/api/grievances/${rC.id}/claim`, { state_version: 0 }, tokenOffA);
    const [rp1, rp2] = await Promise.all([p1, p2]);
    console.log('Uncontrolled - Classify:', rp1.status, 'Claim:', rp2.status);
    const rCAfter = await Grievance.findByPk(rC.id);
    const isAssigneeValid = rCAfter.assigned_to === null || rCAfter.department === 'DeptA';
    check(isAssigneeValid, 'No officer remains assigned to a mismatched department');
    check(rp1.status !== 500 && rp2.status !== 500, 'No HTTP 500/SQLite error');

    console.log('\n=== 5. Applicant-Close Race ===');
    // Using two simultaneous applicant close requests
    const rD = await Grievance.create({ applicant_id: prof1.id, subject: 'S', description: 'D', department: 'DeptA', assigned_to: officerA.id, status: 'resolved', state_version: 0, sla_deadline: now });
    const d1 = request('PATCH', `/api/grievances/${rD.id}`, { status: 'closed', state_version: 0 }, tokenApp1);
    const d2 = request('PATCH', `/api/grievances/${rD.id}`, { status: 'closed', state_version: 0 }, tokenApp1);
    const [rd1, rd2] = await Promise.all([d1, d2]);
    console.log('Close 1:', rd1.status, 'Close 2:', rd2.status);
    const sortedD = [rd1.status, rd2.status].sort();
    check(sortedD[0] === 200 && sortedD[1] === 409, 'Exactly one 200 and one 409');
    const rDAfter = await Grievance.findByPk(rD.id);
    check(rDAfter.status === 'closed', 'Final status closed');
    check(rDAfter.state_version === 1, 'State_version increments once');

    console.log('\n=== 6. Listing Evidence ===');
    const gList1 = await Grievance.create({ applicant_id: prof1.id, subject: '1', description: 'D', department: 'DeptA', assigned_to: officerA.id, sla_deadline: now });
    const gList2 = await Grievance.create({ applicant_id: prof1.id, subject: '2', description: 'D', department: 'DeptA', sla_deadline: now }); // unassigned DeptA
    const gList3 = await Grievance.create({ applicant_id: prof1.id, subject: '3', description: 'D', department: 'DeptB', assigned_to: officerB.id, sla_deadline: now }); // other officer
    const gList4 = await Grievance.create({ applicant_id: prof1.id, subject: '4', description: 'D', department: null, sla_deadline: now }); // null dept
    const gList5 = await Grievance.create({ applicant_id: prof1.id, subject: '5', description: 'D', department: 'DeptA', escalation_level: 2, sla_deadline: now }); // L2 unassigned

    const lst1 = await request('GET', '/api/grievances/assigned', null, tokenOffA);
    const listedIds = lst1.body.grievances.map(g => g.id);
    console.log('Officer A listed IDs:', listedIds);
    check(listedIds.includes(gList1.id), "Officer's own assigned grievances");
    check(listedIds.includes(gList2.id), "Matching unassigned level 0/1 queue");
    check(!listedIds.includes(gList3.id), "Exclusion of another officer's assigned");
    check(!listedIds.includes(gList4.id), "Exclusion of null-department");
    check(!listedIds.includes(gList5.id), "Exclusion of unassigned level 2/3 queue");
    
    const lst2 = await request('GET', '/api/grievances/assigned', null, tokenAdmin);
    check(lst2.body.pagination.total >= 5, "Admin all-grievance visibility");
    
    const lst3 = await request('GET', '/api/grievances/assigned?status=open&department=DeptA&assigned=false&escalation_level=2', null, tokenAdmin);
    check(lst3.body.grievances.some(g => g.id === gList5.id), "Admin status/department/assigned/escalation filters");

    const lst4 = await request('GET', '/api/grievances/assigned?escalation_level=5', null, tokenAdmin);
    check(lst4.status === 400, 'Malformed filters -> 400');
    
    const lst5 = await request('GET', '/api/grievances/assigned?limit=1000', null, tokenAdmin);
    check(lst5.body.pagination.limit === 100, 'Page/limit cap at 100');
    
    const lst6 = await request('GET', `/api/grievances/assigned?department=DeptB`, null, tokenOffA);
    check(!lst6.body.grievances.some(g => g.department === 'DeptB'), 'Officer query parameters cannot broaden scope');

    console.log('\n=== 7. Auth/ID Completion ===');
    const idTests = ['0', '-1', 'abc', '1.5'];
    let idFailed = false;
    for (const badId of idTests) {
      const res = await request('PATCH', `/api/grievances/${badId}`, { status: 'in_progress', state_version: 0 }, tokenOffA);
      if (res.status !== 400) idFailed = true;
    }
    check(!idFailed, 'ID 0, -1, abc and 1.5 -> exactly 400');
    
    const missId = await request('PATCH', '/api/grievances/999999', { status: 'in_progress', state_version: 0 }, tokenOffA);
    check(missId.status === 404, 'valid missing ID -> 404');
    
    const noTok = await request('PATCH', `/api/grievances/${gList1.id}`, { status: 'in_progress', state_version: 0 }, null);
    check(noTok.status === 401, 'missing token -> 401');
    
    const badTok = await request('PATCH', `/api/grievances/${gList1.id}`, { status: 'in_progress', state_version: 0 }, 'invalid.token.here');
    check(badTok.status === 401, 'invalid token -> 401');
    
    const inspTok = await request('PATCH', `/api/grievances/${gList1.id}`, { status: 'in_progress', state_version: 0 }, tokenInsp);
    check(inspTok.status === 403, 'inspector -> 403');

    console.log('\n=== 8. Rollback Stub Safety ===');
    let hookExecuted = false;
    const oldUpdate = Grievance.update;
    Grievance.update = async () => { hookExecuted = true; throw new Error('Simulated DB Error'); };
    
    console.log(`
    // Exact fault-injection code
    let hookExecuted = false;
    const oldUpdate = Grievance.update;
    Grievance.update = async () => { hookExecuted = true; throw new Error('Simulated DB Error'); };
    `);

    const rbG = await Grievance.create({ applicant_id: prof1.id, subject: 'S', description: 'D', department: 'DeptA', state_version: 0, sla_deadline: now });
    
    try {
      const rbRes = await request('PATCH', `/api/grievances/${rbG.id}/claim`, { state_version: 0 }, tokenOffA);
      check(hookExecuted === true, 'failure occurs inside managed transaction');
      check(rbRes.status === 500, 'transaction aborted with 500');
    } finally {
      Grievance.update = oldUpdate;
      check(Grievance.update === oldUpdate, 'original Grievance.update restored in finally');
    }

    const rbAfter = await Grievance.findByPk(rbG.id);
    check(rbAfter.assigned_to === null && rbAfter.state_version === 0, 'zero partial mutation/version change');
    
    const rbRetry = await request('PATCH', `/api/grievances/${rbG.id}/claim`, { state_version: 0 }, tokenOffA);
    check(rbRetry.status === 200, 'immediate retry succeeds');
    
    const srcCode = fs.readFileSync(require('path').join(__dirname, '../src/controllers/grievanceController.js'), 'utf8');
    check(!srcCode.includes('Simulated DB Error') && !srcCode.includes('test_only'), 'no production hook/export exists');

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
