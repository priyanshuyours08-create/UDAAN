'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-priority4';
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = ':memory:';

const http = require('http');
const jwt = require('jsonwebtoken');
const assert = require('assert');
const { Op } = require('sequelize');

const sequelize = require('../src/config/database');
const { User, ApplicantProfile, ApprovalRule, Application, Notification } = require('../src/models');
const { checkAndEscalate } = require('../src/services/slaEscalationService');
const app = require('../src/app');

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
      path: url.pathname + url.search,
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
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let passed = 0;
let failed = 0;

function check(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}`);
  }
}

async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Priority 4: SLA Escalation + Notifications Tests            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  await sequelize.sync({ force: true });

  server = app.listen(0, async () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    
    // Seed basic setup
    const admin = await User.create({ name: 'Admin', email: 'admin@t.com', password_hash: 'x', role: 'admin' });
    const officerA = await User.create({ name: 'OffA', email: 'oa@t.com', password_hash: 'x', role: 'officer', department: 'DeptA' });
    const inspectorA = await User.create({ name: 'InspA', email: 'ia@t.com', password_hash: 'x', role: 'inspector', department: 'DeptA' });
    const officerB = await User.create({ name: 'OffB', email: 'ob@t.com', password_hash: 'x', role: 'officer', department: 'DeptB' });
    
    // FIX-4
    const inspectorC = await User.create({ name: 'InspC', email: 'ic@t.com', password_hash: 'x', role: 'inspector', department: 'DeptC' });
    
    const applicant = await User.create({ name: 'App1', email: 'app@t.com', password_hash: 'x', role: 'applicant' });
    const profile = await ApplicantProfile.create({ user_id: applicant.id, business_name: 'Biz', sector: 'IT', state: 'Delhi', investment_amount: 1, employee_count: 1 });

    const ruleA = await ApprovalRule.create({ approval_name: 'RuleA', department: 'DeptA', risk_level: 'low', sector: 'all', state: 'all', required_documents: '[]' });
    const ruleB = await ApprovalRule.create({ approval_name: 'RuleB', department: 'DeptB', risk_level: 'low', sector: 'all', state: 'all', required_documents: '[]' });
    const ruleC = await ApprovalRule.create({ approval_name: 'RuleC', department: 'DeptC', risk_level: 'low', sector: 'all', state: 'all', required_documents: '[]' });
    const ruleNoDept = await ApprovalRule.create({ approval_name: 'RuleNo', department: '', risk_level: 'low', sector: 'all', state: 'all', required_documents: '[]' });

    const now = new Date();

    console.log('=== A. Warning ===');
    const warningDate = new Date(now.getTime() + 10 * 60 * 60 * 1000); // 10 hours from now
    const appWarn = await Application.create({ applicant_id: profile.id, approval_rule_id: ruleA.id, status: 'pending_review', sla_deadline: warningDate });
    
    let res = await checkAndEscalate();
    console.log('Warning result object:', JSON.stringify(res, null, 2));
    check(res.warnings_sent === 1, 'Warning sent');
    check(res.notifications_created === 2, '2 notifications created (OfficerA, InspectorA)');
    
    let notifs = await Notification.findAll({ where: { reference_id: appWarn.id } });
    check(notifs.length === 2, 'DB has 2 warning notifs');
    const notifUserIds = notifs.map(n => n.user_id).sort();
    check(notifUserIds.join(',') === [officerA.id, inspectorA.id].sort().join(','), 'Correct users notified (no admins, no DeptB)');
    
    await appWarn.reload();
    check(appWarn.last_notified_level === 'warning', 'Level updated to warning');

    console.log('\n=== D. Repeat warning ===');
    res = await checkAndEscalate();
    check(res.warnings_sent === 0, 'No new warnings');
    check(res.notifications_created === 0, 'No duplicate notifications created');

    console.log('\n=== E. Warning then breach ===');
    await appWarn.update({ sla_deadline: new Date(now.getTime() - 1000) }); // Move to past
    res = await checkAndEscalate();
    console.log('Warning-to-breach result object:', JSON.stringify(res, null, 2));
    check(res.breaches_sent === 1, 'Breach sent after warning');
    check(res.notifications_created === 3, '3 breach notifications (OffA, InspA, Admin)');
    
    await appWarn.reload();
    check(appWarn.last_notified_level === 'breach', 'Level updated to breach');
    
    notifs = await Notification.findAll({ where: { reference_id: appWarn.id, type: 'sla_breach' } });
    const breachUserIds = notifs.map(n => n.user_id).sort();
    check(breachUserIds.join(',') === [officerA.id, inspectorA.id, admin.id].sort().join(','), 'Correct users notified for breach including admin');

    console.log('\n=== F. Repeat breach ===');
    res = await checkAndEscalate();
    check(res.breaches_sent === 0, 'No duplicate breaches');
    
    console.log('\n=== B. Breach (Direct) ===');
    const breachDate = new Date(now.getTime() - 1000);
    const appBreach = await Application.create({ applicant_id: profile.id, approval_rule_id: ruleB.id, status: 'pending_review', sla_deadline: breachDate });
    res = await checkAndEscalate();
    console.log('Direct breach result object:', JSON.stringify(res, null, 2));
    check(res.breaches_sent === 1, 'Direct breach sent');
    check(res.notifications_created === 2, '2 breach notifications (OffB, Admin)');

    console.log('\n=== C. FIX-4 inspector-only department ===');
    const appFix4 = await Application.create({ applicant_id: profile.id, approval_rule_id: ruleC.id, status: 'pending_review', sla_deadline: breachDate });
    res = await checkAndEscalate();
    check(res.breaches_sent === 1, 'Breach sent for inspector-only dept');
    check(res.notifications_created === 2, 'Notifies InspectorC and Admin');

    console.log('\n=== G. Monotonic/terminal behavior ===');
    const termApp = await Application.create({ applicant_id: profile.id, approval_rule_id: ruleA.id, status: 'approved', sla_deadline: breachDate });
    res = await checkAndEscalate();
    check(res.breaches_sent === 0, 'Terminal application ignored');
    
    // Attempt downgrade
    await appWarn.update({ sla_deadline: new Date(now.getTime() + 10 * 60 * 60 * 1000) }); // Move back to future
    res = await checkAndEscalate();
    await appWarn.reload();
    check(appWarn.last_notified_level === 'breach', 'Breach level never downgrades to warning or none');

    console.log('\n=== H. Invalid routing/no recipients ===');
    const appInvalid = await Application.create({ applicant_id: profile.id, approval_rule_id: ruleNoDept.id, status: 'pending_review', sla_deadline: breachDate });
    res = await checkAndEscalate();
    console.log('Invalid rule/department result object:', JSON.stringify(res, null, 2));
    check(res.skipped_invalid_rule_or_department >= 1, 'Skipped missing department');
    
    const ruleD = await ApprovalRule.create({ approval_name: 'RuleD', department: 'DeptD', risk_level: 'low', sector: 'all', state: 'all', required_documents: '[]' });
    const appNoRec = await Application.create({ applicant_id: profile.id, approval_rule_id: ruleD.id, status: 'pending_review', sla_deadline: warningDate });
    res = await checkAndEscalate();
    console.log('No recipients result object:', JSON.stringify(res, null, 2));
    check(res.skipped_no_recipients >= 1, 'Skipped empty department');
    await appNoRec.reload();
    check(appNoRec.last_notified_level === 'none', 'Unchanged when no recipients');
    
    // Add recipient and retry
    const officerD = await User.create({ name: 'OffD', email: 'od@t.com', password_hash: 'x', role: 'officer', department: 'DeptD' });
    res = await checkAndEscalate();
    check(res.warnings_sent === 1, 'Succeeds after adding recipient');
    await appNoRec.reload();
    check(appNoRec.last_notified_level === 'warning', 'Successfully updated');

    console.log('\n=== I. Atomic rollback ===');
    const appRollback = await Application.create({ applicant_id: profile.id, approval_rule_id: ruleA.id, status: 'pending_review', sla_deadline: breachDate });
    
    // Induce failure
    const origBulkCreate = Notification.bulkCreate;
    Notification.bulkCreate = async () => { throw new Error('Simulated DB error'); };
    
    try {
      await checkAndEscalate();
    } catch (e) {
      check(e.message === 'Simulated DB error', 'Error propagated');
    }
    Notification.bulkCreate = origBulkCreate; // restore
    
    await appRollback.reload();
    check(appRollback.last_notified_level === 'none', 'Rollback preserves level none');
    
    res = await checkAndEscalate();
    await appRollback.reload();
    check(appRollback.last_notified_level === 'breach', 'Valid retry succeeds');

    console.log('\n=== J. Concurrent service calls ===');
    const appConcurrent = await Application.create({ applicant_id: profile.id, approval_rule_id: ruleA.id, status: 'pending_review', sla_deadline: breachDate });
    const [res1, res2] = await Promise.all([checkAndEscalate(), checkAndEscalate()]);
    
    console.log('Lost CAS race result object 1:', JSON.stringify(res1, null, 2));
    console.log('Lost CAS race result object 2:', JSON.stringify(res2, null, 2));
    
    check(res1.breaches_sent + res2.breaches_sent === 1, 'Only one breach sent across concurrent calls');
    check(res1.skipped_race + res2.skipped_race === 1, 'One call skipped due to CAS race');
    
    const notifCount = await Notification.count({ where: { reference_id: appConcurrent.id, type: 'sla_breach' } });
    check(notifCount === 3, 'Exactly 3 notifications created (no duplicates)');

    console.log('\n=== K. Notification API & Pagination ===');
    const tOfficerA = makeToken(officerA);
    const tOfficerB = makeToken(officerB);
    
    // Create multiple notifications for pagination
    const baseDate = Date.now();
    for (let i = 0; i < 5; i++) {
      await Notification.create({
        user_id: officerA.id,
        type: 'sla_warning',
        title: `Warn ${i}`,
        message: 'M',
        reference_type: 'application',
        reference_id: appConcurrent.id,
        is_read: false,
        createdAt: new Date(baseDate + i * 1000)
      });
    }
    
    // page=1&limit=2 returns exactly 2 newest records
    let rGet = await request('GET', '/api/notifications?page=1&limit=2', null, tOfficerA);
    check(rGet.status === 200, 'GET page=1 limit=2 -> 200');
    check(rGet.data.notifications.length === 2, 'Returns exactly 2 records');
    check(rGet.data.notifications[0].title === 'Warn 4', 'Newest-first ordering (Warn 4 is newest)');
    check(rGet.data.notifications[1].title === 'Warn 3', 'Warn 3 is next');
    check(rGet.data.notifications.every(n => n.user_id === officerA.id), 'Records belong only to req.user.id');
    
    // page=2&limit=2 returns the correct next records with no overlap
    let rGetP2 = await request('GET', '/api/notifications?page=2&limit=2', null, tOfficerA);
    check(rGetP2.status === 200, 'GET page=2 limit=2 -> 200');
    check(rGetP2.data.notifications.length === 2, 'Returns exactly 2 records P2');
    check(rGetP2.data.notifications[0].title === 'Warn 2', 'No overlap, next is Warn 2');
    check(rGetP2.data.notifications[1].title === 'Warn 1', 'Next is Warn 1');
    
    // Test invalid/edge page and limit
    const p1 = await request('GET', '/api/notifications?page=0&limit=10', null, tOfficerA);
    check(p1.data.page === 1, 'page=0 defaults safely');
    const p2 = await request('GET', '/api/notifications?page=-1&limit=10', null, tOfficerA);
    check(p2.data.page === 1, 'page=-1 defaults safely');
    const p3 = await request('GET', '/api/notifications?page=abc&limit=10', null, tOfficerA);
    check(p3.data.page === 1, 'page=abc defaults safely');
    
    const l1 = await request('GET', '/api/notifications?limit=0', null, tOfficerA);
    check(l1.data.limit === 20 || l1.data.limit > 0, 'limit=0 defaults safely');
    const l2 = await request('GET', '/api/notifications?limit=-1', null, tOfficerA);
    check(l2.data.limit === 20 || l2.data.limit > 0, 'limit=-1 defaults safely');
    const l3 = await request('GET', '/api/notifications?limit=abc', null, tOfficerA);
    check(l3.data.limit === 20 || l3.data.limit > 0, 'limit=abc defaults safely');
    const l4 = await request('GET', '/api/notifications?limit=99999', null, tOfficerA);
    check(l4.data.limit <= 100, 'Excessive limit rejected or safely capped (<= 100)');

    const firstNotifId = rGet.data.notifications[0].id;
    const rMarkRead = await request('PATCH', `/api/notifications/${firstNotifId}/read`, null, tOfficerA);
    check(rMarkRead.status === 200, 'Can mark own read');
    check(rMarkRead.data.notification.is_read === true, 'is_read becomes true');
    
    const rRepeatRead = await request('PATCH', `/api/notifications/${firstNotifId}/read`, null, tOfficerA);
    check(rRepeatRead.status === 200, 'Repeat mark read idempotent');

    // Invalid JWT tests
    const rBadJwt1 = await request('GET', '/api/notifications', null, 'invalid_token');
    check(rBadJwt1.status === 401, 'GET with malformed JWT -> 401');
    const rBadJwt2 = await request('PATCH', `/api/notifications/${firstNotifId}/read`, null, 'invalid_token');
    check(rBadJwt2.status === 401, 'mark-read with malformed JWT -> 401');
    const rBadJwt3 = await request('PATCH', '/api/notifications/read-all', null, 'invalid_token');
    check(rBadJwt3.status === 401, 'read-all with malformed JWT -> 401');

    // ID validation tests
    console.log('\n--- Raw Response Dumps for ID Validation ---');
    const idValidOpts = [
      { id: 0, label: 'id=0' },
      { id: -1, label: 'id=-1' },
      { id: 'abc', label: 'id=abc' },
      { id: 1.5, label: 'id=1.5' },
    ];
    for (const opt of idValidOpts) {
      const resId = await request('PATCH', `/api/notifications/${opt.id}/read`, null, tOfficerA);
      console.log(`[PATCH /api/notifications/${opt.id}/read] Status: ${resId.status}, Body:`, JSON.stringify(resId.data));
      check(resId.status === 400, `${opt.label} -> exactly 400`);
    }
    
    const missingIdRes = await request('PATCH', '/api/notifications/999999/read', null, tOfficerA);
    console.log(`[PATCH /api/notifications/999999/read] Status: ${missingIdRes.status}, Body:`, JSON.stringify(missingIdRes.data));
    check(missingIdRes.status === 404, 'Valid positive but nonexistent ID -> exactly 404');
    
    const otherUserIdRes = await request('PATCH', `/api/notifications/${firstNotifId}/read`, null, tOfficerB);
    console.log(`[PATCH /api/notifications/${firstNotifId}/read (other user)] Status: ${otherUserIdRes.status}, Body:`, JSON.stringify(otherUserIdRes.data));
    check(otherUserIdRes.status === 403, 'Existing other-user ID -> exactly 403');

    const ownIdRes = await request('PATCH', `/api/notifications/${firstNotifId}/read`, null, tOfficerA);
    console.log(`[PATCH /api/notifications/${firstNotifId}/read (own user)] Status: ${ownIdRes.status}, Body:`, JSON.stringify(ownIdRes.data));
    check(ownIdRes.status === 200, 'Existing own ID -> exactly 200');
    console.log('--------------------------------------------\n');

    console.log('\n=== L. Manual route authorization ===');
    const tAdmin = makeToken(admin);
    const tApplicant = makeToken(applicant);
    const tInspA = makeToken(inspectorA);
    
    let rAdmin = await request('POST', '/api/admin/run-sla-check', null, tAdmin);
    check(rAdmin.status === 200, 'Admin -> 200');
    let rOff = await request('POST', '/api/admin/run-sla-check', null, tOfficerA);
    check(rOff.status === 200, 'Officer -> 200');
    let rApp = await request('POST', '/api/admin/run-sla-check', null, tApplicant);
    check(rApp.status === 403, 'Applicant -> 403');
    let rInsp = await request('POST', '/api/admin/run-sla-check', null, tInspA);
    check(rInsp.status === 403, 'Inspector -> 403');
    let rNoTok = await request('POST', '/api/admin/run-sla-check');
    check(rNoTok.status === 401, 'No token -> 401');

    console.log('\n=== M. Configuration parsing & indexing ===');
    const pragmaIndexes = await sequelize.query("PRAGMA index_list('Applications')");
    const hasSlaIdx = pragmaIndexes[0].some(idx => idx.name === 'app_sla_polling_idx');
    check(hasSlaIdx, 'app_sla_polling_idx created');
    
    const pragmaNotifIdx = await sequelize.query("PRAGMA index_list('Notifications')");
    check(pragmaNotifIdx[0].some(idx => idx.name === 'notif_user_read_time_idx'), 'notif_user_read_time_idx created');
    check(pragmaNotifIdx[0].some(idx => idx.name === 'notif_reference_idx'), 'notif_reference_idx created');

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`  Results:  ${passed} passed,  ${failed} failed`);
    console.log('═══════════════════════════════════════════════════════════');
    server.close();
    process.exit(failed > 0 ? 1 : 0);
  });
}

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});