'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-priority5-integration';
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = ':memory:';

const http = require('http');
const jwt = require('jsonwebtoken');
const assert = require('assert');
const sequelize = require('../src/config/database');
const {
  User,
  ApplicantProfile,
  ApprovalRule,
  Application,
  Inspection,
  InspectionApplication,
  Notification,
  Grievance,
  GrievanceEscalation
} = require('../src/models');
const app = require('../src/app');
const { runComplianceChecks } = require('../src/services/complianceOrchestrator');
const { startSlaCron, stopSlaCron } = require('../src/services/slaCronService');

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

function request(method, path, body = null, headers = {}, token = null) {
  // If headers is actually a token string, handle it for backwards compatibility within the test
  if (typeof headers === 'string') {
    token = headers;
    headers = {};
  }
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
        resolve({ status: res.statusCode, data: parsed, body: parsed });
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

async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Priority 5: Compliance Orchestrator & End-to-End Tests      ║');
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

    console.log('=== 5. FAILURE-ISOLATION TESTS ===');

    let callsSla = 0;
    let callsGrievance = 0;

    const mockSuccessSla = async () => { callsSla++; return { done: 'sla_ok' }; };
    const mockSuccessGrievance = async () => { callsGrievance++; return { done: 'g_ok' }; };
    const mockFailSla = async () => { callsSla++; throw new Error('SLA fail'); };
    const mockFailGrievance = async () => { callsGrievance++; throw new Error('Grievance fail'); };

    // A. Both succeed
    callsSla = 0; callsGrievance = 0;
    let resA = await runComplianceChecks({ slaChecker: mockSuccessSla, grievanceChecker: mockSuccessGrievance });
    check(callsSla === 1 && callsGrievance === 1, 'A. Both invoked exactly once');
    console.log('Result A:', JSON.stringify(resA));
    check(resA.success === true && resA.partial_failure === false, 'A. success=true, partial_failure=false');
    check(resA.sla.data.done === 'sla_ok' && resA.grievances.data.done === 'g_ok', 'A. full data preserved');

    // B. SLA fails, grievance succeeds
    callsSla = 0; callsGrievance = 0;
    let resB = await runComplianceChecks({ slaChecker: mockFailSla, grievanceChecker: mockSuccessGrievance });
    check(callsSla === 1 && callsGrievance === 1, 'B. Both invoked exactly once');
    console.log('Result B:', JSON.stringify(resB));
    check(resB.success === false && resB.partial_failure === true, 'B. success=false, partial_failure=true');
    check(resB.sla.error === 'SLA_CHECK_FAILED' && !resB.sla.message, 'B. SLA safe code only, no internal message leaked');
    check(resB.grievances.success === true, 'B. grievance still called and succeeds');

    // C. SLA succeeds, grievance fails
    callsSla = 0; callsGrievance = 0;
    let resC = await runComplianceChecks({ slaChecker: mockSuccessSla, grievanceChecker: mockFailGrievance });
    check(callsSla === 1 && callsGrievance === 1, 'C. Both invoked exactly once');
    console.log('Result C:', JSON.stringify(resC));
    check(resC.success === false && resC.partial_failure === true, 'C. success=false, partial_failure=true');
    check(resC.grievances.error === 'GRIEVANCE_CHECK_FAILED', 'C. grievance safe code only');

    // D. Both fail
    callsSla = 0; callsGrievance = 0;
    let resD = await runComplianceChecks({ slaChecker: mockFailSla, grievanceChecker: mockFailGrievance });
    check(callsSla === 1 && callsGrievance === 1, 'D. Both invoked exactly once');
    console.log('Result D:', JSON.stringify(resD));
    check(resD.success === false && resD.partial_failure === false, 'D. success=false, partial_failure=false');
    check(resD.sla.error === 'SLA_CHECK_FAILED' && resD.grievances.error === 'GRIEVANCE_CHECK_FAILED', 'D. safe codes only');

    // E. One checker is slow
    callsSla = 0; callsGrievance = 0;
    let resolveSlowSla;
    const slowSla = async () => { callsSla++; await new Promise(r => { resolveSlowSla = r; }); return { slow: true }; };
    let pE = runComplianceChecks({ slaChecker: slowSla, grievanceChecker: mockSuccessGrievance });
    await new Promise(r => setTimeout(r, 50));
    check(callsSla === 1 && callsGrievance === 1, 'E. other checker starts without waiting for the first to finish');
    resolveSlowSla();
    let resE = await pE;
    console.log('Result E:', JSON.stringify(resE));
    check(resE.success === true, 'E. Promise.all eventually resolves');
    check(callsSla === 1 && callsGrievance === 1, 'E. no false duplicate invocation');

    // F. Unexpected orchestrator-level rejection (in controller context)
    const complianceOrchestrator = require('../src/services/complianceOrchestrator');
    const oldRunComplianceChecks = complianceOrchestrator.runComplianceChecks;
    complianceOrchestrator.runComplianceChecks = async () => { throw new Error('Generic error'); };

    let resF = await request('POST', '/api/admin/run-sla-check', null, adminToken);

    complianceOrchestrator.runComplianceChecks = oldRunComplianceChecks; // restore
    console.log('Result F:', JSON.stringify(resF));
    check(resF.status === 500, 'F. admin controller returns generic 500');
    check(resF.data.error === 'Internal server error', 'F. admin controller generic error');


    console.log("\n=== 7. RAW SQLITE INTEGRATION ===");
    let dbTestsRun = 0;
    const checkNoSqliteBusy = (resList) => {
        const hasBusy = resList.some(r => r && r.data && r.data.error && String(r.data.error).includes("SQLITE_BUSY"));
        check(!hasBusy, "No SQLITE_BUSY");
        const hasNoTx = resList.some(r => r && r.data && r.data.error && String(r.data.error).includes("no transaction is active"));
        check(!hasNoTx, "No cannot commit - no transaction is active");
        const has404 = resList.some(r => r && r.status === 404);
        check(!has404, "No 404");
        const has500 = resList.some(r => r && r.status === 500);
        check(!has500, "No 500 (unless expected)");
    };

    // Helper to seed due SLA
    const seedDueApplication = async () => {
        let rApp = await request("POST", "/api/applications/submit", { applicant_id: applicantProfile.id }, applicantToken);
        let app_id = rApp.data.applications ? rApp.data.applications[0].application_id : rApp.data.id;
        let dApp = await Application.findByPk(app_id);
        await dApp.update({ sla_deadline: new Date(Date.now() - 1000) });
        return dApp;
    };

    // Helper to seed due grievance
    const seedDueGrievance = async () => {
        let rGriev = await request("POST", "/api/grievances", { subject: "ScenX", description: "DescX", priority: "medium" }, applicantToken);
        let g_id = rGriev.data.grievance ? rGriev.data.grievance.id : rGriev.data.id;
        let dGriev = await Grievance.findByPk(g_id);
        await dGriev.update({ next_escalation_at: new Date(Date.now() - 1000) });
        return dGriev;
    };

    const runWithRealWrite = async (scenario, requestPromiseFactory, verifyMutation) => {
        console.log(`${scenario}`);
        let slaBefore = await Application.count({ where: { status: 'pending_review' } });
        let gBefore = await Grievance.count({ where: { status: 'open' } });

        // Seed so compliance orchestration has actual work
        await seedDueApplication();
        await seedDueGrievance();

        const notifBefore = await Notification.count();
        const escBefore = await GrievanceEscalation.count();

        let pReq = requestPromiseFactory();
        let resList = await Promise.all([ runComplianceChecks(), pReq ]);

        console.log(`Result ${scenario}:`, JSON.stringify(resList));
        checkNoSqliteBusy(resList);

        const notifAfter = await Notification.count();
        const escAfter = await GrievanceEscalation.count();
        check(notifAfter > notifBefore || escAfter > escBefore, `${scenario} compliance side mutation committed`);

        if (verifyMutation) {
           await verifyMutation(resList);
        }
    };

    await runWithRealWrite("Scenario 1: Cron tick + manual compliance route",
        () => request("POST", "/api/admin/run-sla-check", null, adminToken),
        async () => {}
    );

    await runWithRealWrite("Scenario 2: Two manual compliance routes",
        () => request("POST", "/api/admin/run-sla-check", null, adminToken),
        async () => {}
    );

    await runWithRealWrite("Scenario 3: Two cron callback invocations/overlap attempt",
        () => runComplianceChecks(),
        async () => {}
    );

    await runWithRealWrite("Scenario 4: Compliance + application submission",
        () => request("POST", "/api/applications/submit", { applicant_id: applicantProfile.id }, applicantToken),
        async () => {}
    );

    console.log("Scenario 5: Compliance + inspection bundle");
    let s5app = await request("POST", "/api/applications/submit", { applicant_id: applicantProfile.id }, applicantToken);
    let s5appId = s5app.data.applications ? s5app.data.applications[0].application_id : s5app.data.id;
    let s5dbApp = await Application.findByPk(s5appId);
    await s5dbApp.update({ status: 'pending_inspection', risk_level: 'medium', requires_inspection: true });

    await seedDueApplication();
    let s5Res = await Promise.all([ runComplianceChecks(), request("POST", "/api/inspections/bundle", { applicant_id: applicantProfile.id }, applicantToken) ]);
    checkNoSqliteBusy(s5Res);
    check(s5Res[1].status === 201 || s5Res[1].status === 200, "Scenario 5 HTTP 200/201");
    let inspCount = await Inspection.count();
    let inspAppCount = await InspectionApplication.count({ where: { application_id: s5appId }});
    check(inspCount >= 1, "Inspection created");
    check(inspAppCount === 1, "InspectionApplication link created exactly once");

    console.log("Scenario 6: Compliance + inspection completion");
    let s6inspRes = await request("POST", "/api/inspections/bundle", { applicant_id: applicantProfile.id }, applicantToken); // in case we need another one
    let inspToComplete = await Inspection.findOne({ where: { status: 'scheduled' } });
    if (!inspToComplete) {
       // Just force create one
       inspToComplete = await Inspection.create({ applicant_id: applicantProfile.id, status: 'scheduled', assigned_inspector_id: inspectorUser.id, scheduled_at: new Date() });
    } else {
       await inspToComplete.update({ assigned_inspector_id: inspectorUser.id });
    }
    await seedDueGrievance(); // Force compliance to write
    let s6Res = await Promise.all([ runComplianceChecks(), request("PATCH", `/api/inspections/${inspToComplete.id}/complete`, { result: "pass" }, inspectorToken) ]);
    checkNoSqliteBusy(s6Res);
    check(s6Res[1].status === 200, "Scenario 6 completion HTTP 200");
    let s6Check = await Inspection.findByPk(inspToComplete.id);
    check(s6Check.status === 'completed', "Inspection completed successfully");

    // We skip the generic wrapper for 7-11 to keep it clean, let's just do them individually with seed Due before each.

    console.log("Scenario 7: Compliance + grievance creation");
    await seedDueApplication();
    let r7_7 = await Promise.all([ runComplianceChecks(), request("POST", "/api/grievances", { subject: "Scen7", description: "Desc7", priority: "medium" }, applicantToken) ]);
    checkNoSqliteBusy(r7_7);
    let g1_id = r7_7[1].data.grievance ? r7_7[1].data.grievance.id : r7_7[1].data.id;
    check(r7_7[1].status === 201 || r7_7[1].status === 200, "Grievance created successfully");

    console.log("Scenario 8: Compliance + grievance classification");
    await seedDueGrievance();
    let r7_8 = await Promise.all([ runComplianceChecks(), request("PATCH", `/api/grievances/${g1_id}/classify`, { department: "DeptA", state_version: 0 }, adminToken) ]);
    checkNoSqliteBusy(r7_8);
    console.log("R7_8", JSON.stringify(r7_8[1])); check(r7_8[1].status === 200, "Classified successfully");

    console.log("Scenario 9: Compliance + grievance claim/assignment");
    await seedDueGrievance();
    let r7_9 = await Promise.all([ runComplianceChecks(), request("PATCH", `/api/grievances/${g1_id}/claim`, { state_version: 1 }, officerToken) ]);
    checkNoSqliteBusy(r7_9);
    console.log("R7_9", JSON.stringify(r7_9[1])); check(r7_9[1].status === 200, "Claimed successfully");

    console.log("Scenario 10: Compliance + grievance status update");
    await seedDueGrievance();
    let r7_10 = await Promise.all([ runComplianceChecks(), request("PATCH", `/api/grievances/${g1_id}`, { status: "in_progress", state_version: 2 }, officerToken) ]);
    checkNoSqliteBusy(r7_10);
    check(r7_10[1].status === 200, "Status updated successfully");

    console.log("Scenario 11: Compliance + manual grievance escalation");
    await seedDueGrievance();
    let r7_11 = await Promise.all([ runComplianceChecks(), request("POST", `/api/grievances/${g1_id}/escalate`, { reason: "R1", state_version: 3 }, { "Idempotency-Key": "K7_11" }, applicantToken) ]);
    checkNoSqliteBusy(r7_11);
    check(r7_11[1].status === 200, "Escalated successfully");

    console.log("Scenario 12: Manual grievance escalation + grievance status update");
    let s12gRes = await request("POST", "/api/grievances", { subject: "S12", description: "D12", priority: "medium" }, applicantToken);
    let s12g_id = s12gRes.data.grievance ? s12gRes.data.grievance.id : s12gRes.data.id;
    await request("PATCH", `/api/grievances/${s12g_id}/classify`, { department: "DeptA", state_version: 0 }, adminToken);
    await request("PATCH", `/api/grievances/${s12g_id}/claim`, { state_version: 1 }, officerToken);
    await request("PATCH", `/api/grievances/${s12g_id}`, { status: "in_progress", state_version: 2 }, officerToken);

    let s12db = await Grievance.findByPk(s12g_id);
    await s12db.update({ next_escalation_at: new Date(Date.now() - 1000) }); // make it due

    // Launch both simultaneously
    let r7_12 = await Promise.all([
       request("POST", `/api/grievances/${s12g_id}/escalate`, { reason: "R12", state_version: 3 }, { "Idempotency-Key": "K7_12" }, applicantToken),
       request("PATCH", `/api/grievances/${s12g_id}`, { status: "resolved", resolution_notes: "S12 resolved", state_version: 3 }, officerToken)
    ]);
    checkNoSqliteBusy(r7_12);

    let s12success = r7_12.filter(r => r.status === 200);
    let s12conflict = r7_12.filter(r => r.status === 409);
    check(s12success.length === 1, "Exactly one successful mutation");
    check(s12conflict.length === 1, "Loser gets exact 409 stale/state conflict");

    let s12final = await Grievance.findByPk(s12g_id);
    check(s12final.state_version === 4, "state_version increments exactly once");

    console.log("Scenario 13: Notification rollback on error");

    let rbGRes = await request("POST", "/api/grievances", { subject: "RB", description: "RB", priority: "low" }, applicantToken);
    let rbG_id = rbGRes.data.grievance ? rbGRes.data.grievance.id : rbGRes.data.id;
    await request("PATCH", `/api/grievances/${rbG_id}/classify`, { department: "DeptA", state_version: 0 }, adminToken);
    await request("PATCH", `/api/grievances/${rbG_id}/claim`, { state_version: 1 }, officerToken);

    let rbGBefore = await Grievance.findByPk(rbG_id);
    const initialNotifCount = await Notification.count();

    const originalCreate = Notification.create;
    Notification.create = async () => { throw new Error("Simulated Notification Failure"); };

    let r7_13_fail = await request("PATCH", `/api/grievances/${rbG_id}`, { status: "in_progress", state_version: 2 }, officerToken);

    Notification.create = originalCreate;

    let rbGAfter = await Grievance.findByPk(rbG_id);
    const afterNotifCount = await Notification.count();

    console.log("R7_13_FAIL", JSON.stringify(r7_13_fail)); check(r7_13_fail.status === 500, "Notification rollback HTTP 500");
    check(r7_13_fail.data && r7_13_fail.data.error === "Internal server error", "Safe HTTP 500 body");
    check(rbGAfter.status === rbGBefore.status, "Status unchanged on rollback");
    check(rbGAfter.state_version === rbGBefore.state_version, "State version unchanged on rollback");
    check(rbGAfter.resolved_at === rbGBefore.resolved_at, "resolved_at unchanged on rollback");
    check(String(rbGAfter.next_escalation_at) === String(rbGBefore.next_escalation_at), "next_escalation_at unchanged on rollback");
    check(initialNotifCount === afterNotifCount, "Notification count unchanged on rollback");

    let r7_13_retry = await request("PATCH", `/api/grievances/${rbG_id}`, { status: "in_progress", state_version: 2 }, officerToken);
    console.log("R7_13_RETRY", JSON.stringify(r7_13_retry)); check(r7_13_retry.status === 200, "Retry returns 200");
    const finalNotifCount = await Notification.count();
    check(finalNotifCount === initialNotifCount + 1, "Retry creates exactly one notification");

    console.log('\n=== 8. FINAL PRIORITY 5 ACCEPTANCE ===');
console.log('\n=== 8. FINAL PRIORITY 5 ACCEPTANCE ===');
console.log('\n=== 8. FINAL PRIORITY 5 ACCEPTANCE ===');

    await sequelize.sync({ force: true });
    await setupDatabase();

    // Journey A: linked grievance
    let rA_app = await request('POST', '/api/applications/submit', { applicant_id: applicantProfile.id }, applicantToken);
    check(rA_app.status === 201 || rA_app.status === 200, `Journey A app creation successful, got ${rA_app.status}: ${JSON.stringify(rA_app.data)}`);
    let rA_app_id = rA_app.data.applications ? rA_app.data.applications[0].application_id : rA_app.data.id;
    let rA_g = await request('POST', '/api/grievances', { application_id: rA_app_id, subject: 'Linked', description: 'Desc', priority: 'high' }, applicantToken);
    check(rA_g.status === 201 || rA_g.status === 200, `Journey A grievance creation successful, got ${rA_g.status}: ${JSON.stringify(rA_g.data)}`);
    let gA = rA_g.data.grievance || rA_g.data;

    let rA_claim = await request('PATCH', `/api/grievances/${gA.id}/claim`, { state_version: 0 }, officerToken);
    check(rA_claim.status === 200, `Journey A claim successful, got ${rA_claim.status}`);
    check(rA_claim.status === 200, 'Journey A: exact-department officer claims linked grievance');

    let rA_status = await request('PATCH', `/api/grievances/${gA.id}`, { status: 'in_progress', state_version: 1 }, officerToken);
    check(rA_status.status === 200, `Journey A: officer moves open -> in_progress (got ${rA_status.status}: ${JSON.stringify(rA_status.data || rA_status.error)})`);

    let rA_esc = await request('POST', `/api/grievances/${gA.id}/escalate`, { reason: 'Escalation A1', state_version: 2 }, { 'Idempotency-Key': 'JA_ESC_1' }, applicantToken);
    check(rA_esc.status === 200, `Journey A: applicant manual escalation (got ${rA_esc.status}: ${JSON.stringify(rA_esc.data || rA_esc.error)})`);

    let rA_esc2 = await request('POST', `/api/grievances/${gA.id}/escalate`, { reason: 'Escalation A2', state_version: 3 }, { 'Idempotency-Key': 'JA_ESC_2' }, applicantToken);
    check(rA_esc2.status === 409, 'Journey A: cooldown enforced (409)');

    // Force time for automatic escalation
    let gA_db = await Grievance.findByPk(gA.id);
    await gA_db.update({ next_escalation_at: new Date(Date.now() - 1000) });
    await runComplianceChecks();

    gA_db = await Grievance.findByPk(gA.id);
    check(gA_db.escalation_level === 2 && gA_db.assigned_to === null, `Journey A: level 2 clears assignee and enters admin queue (got level ${gA_db.escalation_level}, assignee ${gA_db.assigned_to})`);

    // Admin reassigns
    let rA_reclaim = await request('PATCH', `/api/grievances/${gA.id}/claim`, { assignee_id: officerUser.id, state_version: gA_db.state_version }, adminToken);
    check(rA_reclaim.status === 200, `Journey A: admin reassigns (got ${rA_reclaim.status}: ${JSON.stringify(rA_reclaim.data || rA_reclaim.error)})`);

    // Officer resolves
    let rA_res = await request('PATCH', `/api/grievances/${gA.id}`, { status: 'resolved', resolution_notes: 'Done', state_version: gA_db.state_version + 1 }, officerToken);
    check(rA_res.status === 200, `Journey A: officer resolves with notes (got ${rA_res.status}: ${JSON.stringify(rA_res.data || rA_res.error)})`);

    // Applicant closes
    let rA_close = await request('PATCH', `/api/grievances/${gA.id}`, { status: 'closed', state_version: gA_db.state_version + 2 }, applicantToken);
    check(rA_close.status === 200, `Journey A: applicant closes (got ${rA_close.status}: ${JSON.stringify(rA_close.data || rA_close.error)})`);

    let historyA = await GrievanceEscalation.findAll({ where: { grievance_id: gA.id } });
    check(historyA.length === 2, 'Journey A: audit history complete (2 escalations)');

    // Journey B: unlinked grievance
    let rB_g = await request('POST', '/api/grievances', { subject: 'Unlinked', description: 'Desc', priority: 'medium' }, applicantToken);
    check(rB_g.status === 201 || rB_g.status === 200, `Journey B grievance creation successful, got ${rB_g.status}`);
    let gB = rB_g.data.grievance || rB_g.data;

    let rB_claim = await request('PATCH', `/api/grievances/${gB.id}/claim`, { state_version: 0 }, officerToken);
    check(rB_claim.status === 403 || rB_claim.status === 404, `Journey B: exact-department officer cannot claim unclassified (got ${rB_claim.status})`);

    let rB_class = await request('PATCH', `/api/grievances/${gB.id}/classify`, { department: 'DeptA', state_version: 0 }, adminToken);
    check(rB_class.status === 200, `Journey B: admin classifies triage (got ${rB_class.status}: ${JSON.stringify(rB_class.data || rB_class.error)})`);

    let rB_claim2 = await request('PATCH', `/api/grievances/${gB.id}/claim`, { state_version: 1 }, officerToken);
    check(rB_claim2.status === 200, `Journey B: exact-department officer can claim classified (got ${rB_claim2.status}: ${JSON.stringify(rB_claim2.data || rB_claim2.error)})`);

    // Journey C: idempotency/rollback
    let rC_g = await request('POST', '/api/grievances', { subject: 'JC', description: 'DC', priority: 'low' }, applicantToken);
    check(rC_g.status === 201 || rC_g.status === 200, `Journey C grievance creation successful, got ${rC_g.status}`);
    let gC = rC_g.data.grievance || rC_g.data;

    let rC_esc1 = await request('POST', `/api/grievances/${gC.id}/escalate`, { reason: 'C1', state_version: 0 }, { 'Idempotency-Key': 'KEY_C1' }, applicantToken);
    let rC_esc2 = await request('POST', `/api/grievances/${gC.id}/escalate`, { reason: 'C1', state_version: 0 }, { 'Idempotency-Key': 'KEY_C1' }, applicantToken);
    check(rC_esc1.status === 200 && rC_esc2.status === 200 && rC_esc2.data.replayed === true, `Journey C: same escalation key replay (got esc1=${rC_esc1.status}, esc2=${rC_esc2.status})`);

    let rC_esc3 = await request('POST', `/api/grievances/${gC.id}/escalate`, { reason: 'C2', state_version: 0 }, { 'Idempotency-Key': 'KEY_C1' }, applicantToken);
    check(rC_esc3.status === 409, `Journey C: changed payload conflict (got ${rC_esc3.status})`);

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
