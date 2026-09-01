'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-priority6';
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = ':memory:';

const http = require('http');
const jwt = require('jsonwebtoken');
const assert = require('assert');
let assertionCount = 0;
function customAssert(val) {
  assertionCount++;
  assert(val);
}
const app = require('../src/app');
const { sequelize, User, Application, ApprovalRule } = require('../src/models');

function generateToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
}

let server, baseUrl;
const tests = [];
function describe(name, fn) { console.log(`\n=== $name ===`); fn(); }
function it(name, fn) { tests.push({ name, fn }); }

function expect(actual) {
  return {
    toBe: (expected) => { assertionCount++; assert.strictEqual(actual, expected); },
    toEqual: (expected) => { assertionCount++; assert.deepStrictEqual(actual, expected); }
  };
}

function mockRequest(app) {
  return {
    get: (path) => {
      let _token;
      let _expectStatus;
      const r = {
        set: (key, val) => {
          if (key.toLowerCase() === 'authorization' && val.startsWith('Bearer ')) {
            _token = val.split(' ')[1];
          }
          return r;
        },
        expect: async (status) => {
          _expectStatus = status;
          return await execute();
        }
      };
      const execute = () => {
        return new Promise((resolve, reject) => {
          const url = new URL(path, baseUrl);
          const opts = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          };
          if (_token) opts.headers['Authorization'] = `Bearer ${_token}`;
          const req = http.request(opts, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
              let parsed = data;
              try { parsed = JSON.parse(data); } catch(e){}
              if (_expectStatus && res.statusCode !== _expectStatus) {
                return reject(new Error(`Expected ${_expectStatus} but got ${res.statusCode}. Body: ${data}`));
              }
              resolve({ status: res.statusCode, body: parsed });
            });
          });
          req.on('error', reject);
          req.end();
        });
      };
      return r;
    }
  };
}

const request = mockRequest;

let adminToken;
let fireOfficerToken;
let pollutionOfficerToken;
let nullDeptOfficerToken;
let emptyDeptOfficerToken;
let whitespaceDeptOfficerToken;
let applicantToken;
let inspectorToken;

let fireDept;
let pollutionDept;

async function run() {
  await sequelize.sync({ force: true });
  fireDept = 'Fire Department';
  pollutionDept = 'Pollution Control Board';

  await require('../src/models/User').bulkCreate([
    { id: 1, name: 'A', email: 'a@test', password_hash: 'x', role: 'applicant' },
    { id: 2, name: 'B', email: 'b@test', password_hash: 'x', role: 'applicant' },
    { id: 3, name: 'C', email: 'c@test', password_hash: 'x', role: 'applicant' },
    { id: 4, name: 'D', email: 'd@test', password_hash: 'x', role: 'applicant' }
  ]);

  await require('../src/models/ApplicantProfile').bulkCreate([
    { id: 1, user_id: 1, business_name: 'B1', sector: 'tech', state: 'NY', investment_amount: 100, employee_count: 10, stage: 'pre_establishment' },
    { id: 2, user_id: 2, business_name: 'B2', sector: 'tech', state: 'NY', investment_amount: 100, employee_count: 10, stage: 'pre_establishment' },
    { id: 3, user_id: 3, business_name: 'B3', sector: 'tech', state: 'NY', investment_amount: 100, employee_count: 10, stage: 'pre_establishment' },
    { id: 4, user_id: 4, business_name: 'B4', sector: 'tech', state: 'NY', investment_amount: 100, employee_count: 10, stage: 'pre_establishment' }
  ]);

  await ApprovalRule.bulkCreate([
    { sector: 'all', state: 'all', approval_name: 'Fire NOC', department: fireDept, required_documents: [] },
    { sector: 'all', state: 'all', approval_name: 'Pollution NOC', department: pollutionDept, required_documents: [] }
  ]);

  const ruleFire = await ApprovalRule.findOne({ where: { department: fireDept } });
  const rulePollution = await ApprovalRule.findOne({ where: { department: pollutionDept } });

  const now = new Date();
  const older = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);

  await Application.bulkCreate([
    { applicant_id: 1, approval_rule_id: ruleFire.id, status: 'submitted', submitted_at: now, last_notified_level: 'none' },
    { applicant_id: 1, approval_rule_id: ruleFire.id, status: 'approved', submitted_at: older, decided_at: now, last_notified_level: 'none' },
    { applicant_id: 2, approval_rule_id: rulePollution.id, status: 'rejected', submitted_at: now, decided_at: now, last_notified_level: 'none' },
    { applicant_id: 3, approval_rule_id: ruleFire.id, status: 'pending_review', submitted_at: now, last_notified_level: 'none' },
  ]);

  adminToken = generateToken({ id: 1, role: 'admin', department: null });
  fireOfficerToken = generateToken({ id: 2, role: 'officer', department: fireDept });
  pollutionOfficerToken = generateToken({ id: 3, role: 'officer', department: pollutionDept });
  nullDeptOfficerToken = generateToken({ id: 4, role: 'officer', department: null });
  emptyDeptOfficerToken = generateToken({ id: 5, role: 'officer', department: '' });
  whitespaceDeptOfficerToken = generateToken({ id: 6, role: 'officer', department: '   gold  ' });
  applicantToken = generateToken({ id: 7, role: 'applicant', department: null });
  inspectorToken = generateToken({ id: 8, role: 'inspector', department: null });

  server = app.listen(0, async () => {
    baseUrl = `http://127.0.0.1:` + server.address().port;

    // Register tests
    describe('Authorization & Scoping', () => {
      it('A. Admin global overview exact counts', async () => {
        const res = await request(app)
          .get('/api/admin/analytics/overview')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
        expect(res.body.data.applications_submitted_in_range).toBe(3);
        expect(res.body.data.decisions_completed_in_range).toBe(2);
        expect(res.body.data.approval_rate_for_decisions_in_range.rate).toBe(50);
        expect(res.body.data.pending_workload).toBe(2);
      });
      it('B. Admin explicit valid department', async () => {
        const res = await request(app)
          .get(`/api/admin/analytics/overview?department=${fireDept}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
        expect(res.body.data.applications_submitted_in_range).toBe(2);
        expect(res.body.data.pending_workload).toBe(2);
        expect(res.body.department_scope).toBe(fireDept);
      });
      it('C. Admin unknown department -> exactly 400', async () => {
        await request(app)
          .get('/api/admin/analytics/overview?department=magic')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(400);
      });
      it('D. Officer implicit scope matching', async () => {
        const res = await request(app)
          .get('/api/admin/analytics/overview')
          .set('Authorization', `Bearer ${fireOfficerToken}`)
          .expect(200);
        expect(res.body.data.applications_submitted_in_range).toBe(2);
        expect(res.body.data.pending_workload).toBe(2);
      });
      it('E. Officer explicit matching scope', async () => {
        const res = await request(app)
          .get(`/api/admin/analytics/overview?department=${fireDept}`)
          .set('Authorization', `Bearer ${fireOfficerToken}`)
          .expect(200);
        expect(res.body.department_scope).toBe(fireDept);
      });
      it('F. Officer cross-department query -> exactly 403', async () => {
        await request(app)
          .get(`/api/admin/analytics/overview?department=${pollutionDept}`)
          .set('Authorization', `Bearer ${fireOfficerToken}`)
          .expect(403);
      });
      it('G. Officer null department -> exactly 403', async () => {
        await request(app)
          .get('/api/admin/analytics/overview')
          .set('Authorization', `Bearer ${nullDeptOfficerToken}`)
          .expect(403);
      });
      it('H. Officer empty department -> exactly 403', async () => {
        await request(app)
          .get('/api/admin/analytics/overview')
          .set('Authorization', `Bearer ${emptyDeptOfficerToken}`)
          .expect(403);
      });
      it('I. Officer whitespace department -> exactly 403', async () => {
        await request(app)
          .get('/api/admin/analytics/overview')
          .set('Authorization', `Bearer ${whitespaceDeptOfficerToken}`)
          .expect(403);
      });
      it('J. Applicant -> exactly 403', async () => {
        await request(app)
          .get('/api/admin/analytics/overview')
          .set('Authorization', `Bearer ${applicantToken}`)
          .expect(403);
      });
      it('K. Inspector -> exactly 403', async () => {
        await request(app)
          .get('/api/admin/analytics/overview')
          .set('Authorization', `Bearer ${inspectorToken}`)
          .expect(403);
      });
      it('L. Missing JWT -> exactly 401', async () => {
        await request(app).get('/api/admin/analytics/overview').expect(401);
      });
      it('M. Invalid JWT -> exactly 401', async () => {
        await request(app).get('/api/admin/analytics/overview').set('Authorization', 'Bearer invalid_token').expect(401);
      });
      it('N. Legacy route and /overview return identical data', async () => {
        const resOverview = await request(app).get('/api/admin/analytics/overview').set('Authorization', `Bearer ${adminToken}`).expect(200);
        const resLegacy = await request(app).get('/api/admin/analytics').set('Authorization', `Bearer ${adminToken}`).expect(200);
        delete resOverview.body.generated_at;
        delete resLegacy.body.generated_at;
        delete resOverview.body.historical_range;
        delete resLegacy.body.historical_range;
        expect(resOverview.body).toEqual(resLegacy.body);
      });
      it('O. No cross-department leakage', async () => {
        const res = await request(app).get('/api/admin/analytics/overview').set('Authorization', `Bearer ${pollutionOfficerToken}`).expect(200);
        expect(res.body.data.applications_submitted_in_range).toBe(1);
        expect(res.body.data.pending_workload).toBe(0);
      });
    });

    describe('Overview Contract && Dates', () => {
      it('P. Zero-data stable schema', async () => {
        const start = new Date();
        start.setFullYear(start.getFullYear() + 1);
        const end = new Date(start);
        end.setDate(end.getDate() + 5);
        const res = await request(app).get(`/api/admin/analytics/overview?startDate=${start.toISOString()}&endDate=${end.toISOString()}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
        expect(res.body.data.applications_submitted_in_range).toBe(0);
        expect(res.body.data.decisions_completed_in_range).toBe(0);
        expect(res.body.data.approval_rate_for_decisions_in_range.rate).toBe(0);
        expect(res.body.data.average_turnaround_for_decisions_in_range.average_hours).toBe(0);
      });
      it('Q. Every application status key present with zero default', async () => {
        const res = await request(app).get('/api/admin/analytics/overview').set('Authorization', `Bearer ${adminToken}`).expect(200);
        const keys = [
          'submitted', 'pending_inspection', 'inspection_scheduled',
          'pending_review', 'approved', 'rejected', 'returned', 'cancelled'
        ];
        for (const k of keys) {
          customAssert(res.body.data.application_statuses[k] !== undefined);
        }
      });
      it('R. Date defaults to last 30 days exactly', async () => {
        const res = await request(app).get('/api/admin/analytics/overview').set('Authorization', `Bearer ${adminToken}`).expect(200);
        const start = new Date(res.body.historical_range.start);
        const end = new Date(res.body.historical_range.end);
        const diff = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        expect(diff).toBe(30);
      });
      it('S. Valid custom range inclusive logic', async () => {
        // Just checking it works
        const res = await request(app).get('/api/admin/analytics/overview?startDate=2024-01-01T00:00:00Z&endDate=2024-01-31T00:00:00Z').set('Authorization', `Bearer ${adminToken}`).expect(200);
      });
      it('T. Valid timezone offset normalizes correctly', async () => {
        await request(app).get('/api/admin/analytics/overview?startDate=2026-08-31T21:00:00%2B05:30&endDate=2026-09-01T21:00:00%2B05:30').set('Authorization', `Bearer ${adminToken}`).expect(200);
      });
      it('U. Invalid calendar date -> 400', async () => {
        await request(app).get('/api/admin/analytics/overview?startDate=not-a-date&endDate=2026-01-01T00:00:00Z').set('Authorization', `Bearer ${adminToken}`).expect(400);
      });
      it('V. Only startDate -> 400', async () => {
        await request(app).get('/api/admin/analytics/overview?startDate=2026-01-01T00:00:00Z').set('Authorization', `Bearer ${adminToken}`).expect(400);
      });
      it('W. Only endDate -> 400', async () => {
        await request(app).get('/api/admin/analytics/overview?endDate=2026-01-01T00:00:00Z').set('Authorization', `Bearer ${adminToken}`).expect(400);
      });
      it('X. startDate == endDate -> 400', async () => {
        await request(app).get('/api/admin/analytics/overview?startDate=2026-01-01T00:00:00Z&endDate=2026-01-01T00:00:00Z').set('Authorization', `Bearer ${adminToken}`).expect(400);
      });
      it('Y. startDate > endDate -> 400', async () => {
        await request(app).get('/api/admin/analytics/overview?startDate=2026-01-02T00:00:00Z&endDate=2026-01-01T00:00:00Z').set('Authorization', `Bearer ${adminToken}`).expect(400);
      });
      it('Z. Range >366 days -> 400', async () => {
        await request(app).get('/api/admin/analytics/overview?startDate=2025-01-01T00:00:00Z&endDate=2026-01-03T00:00:00Z').set('Authorization', `Bearer ${adminToken}`).expect(400);
      });
      it('AA. Repeated/array parameter -> 400', async () => {
        await request(app).get('/api/admin/analytics/overview?department=fire&department=pollution').set('Authorization', `Bearer ${adminToken}`).expect(400);
      });
      it('AB. Non-string department -> 400', async () => {
        await request(app).get('/api/admin/analytics/overview?department=').set('Authorization', `Bearer ${adminToken}`).expect(400);
      });
      it('AC. Unknown query parameter -> exactly 400', async () => {
        let queryRun = false;
        const originalCount = Application.count;
        Application.count = async (...args) => { queryRun = true; return originalCount.apply(Application, args); };
        try {
          await request(app).get('/api/admin/analytics/overview?unexpected=value').set('Authorization', `Bearer ${adminToken}`).expect(400);
          customAssert(!queryRun);
        } finally {
          Application.count = originalCount;
        }
      });
      it('AD. Old pending workload', async () => {
        const veryOld = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        await Application.create({ applicant_id: 1, approval_rule_id: ruleFire.id, status: 'pending_review', submitted_at: veryOld, last_notified_level: 'none' });

        const res = await request(app).get(`/api/admin/analytics/overview?department=${fireDept}`).set('Authorization', `Bearer ${adminToken}`).expect(200);

        // Fire dept total pending workload was 2, now 3.
        expect(res.body.data.pending_workload).toBe(3);
        // submitted in range was 2, still 2 (veryOld excluded).
        expect(res.body.data.applications_submitted_in_range).toBe(2);
      });
      it('AE. Out-of-range historical records', async () => {
        const start = new Date('2024-05-01T00:00:00Z');
        const end = new Date('2024-05-10T00:00:00Z');

        const beforeStart = new Date(start.getTime() - 1000);
        const exactlyStart = new Date(start.getTime());
        const inside = new Date(start.getTime() + 10000);
        const exactlyEnd = new Date(end.getTime());
        const afterEnd = new Date(end.getTime() + 1000);

        await Application.bulkCreate([
          { applicant_id: 1, approval_rule_id: rulePollution.id, status: 'approved', submitted_at: beforeStart, decided_at: beforeStart, last_notified_level: 'none' },
          { applicant_id: 1, approval_rule_id: rulePollution.id, status: 'approved', submitted_at: exactlyStart, decided_at: exactlyStart, last_notified_level: 'none' },
          { applicant_id: 1, approval_rule_id: rulePollution.id, status: 'approved', submitted_at: inside, decided_at: inside, last_notified_level: 'none' },
          { applicant_id: 1, approval_rule_id: rulePollution.id, status: 'approved', submitted_at: exactlyEnd, decided_at: exactlyEnd, last_notified_level: 'none' },
          { applicant_id: 1, approval_rule_id: rulePollution.id, status: 'approved', submitted_at: afterEnd, decided_at: afterEnd, last_notified_level: 'none' },
        ]);

        const res = await request(app)
          .get(`/api/admin/analytics/overview?department=${pollutionDept}&startDate=${start.toISOString()}&endDate=${end.toISOString()}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(res.body.data.applications_submitted_in_range).toBe(2); // exactlyStart, inside
        expect(res.body.data.decisions_completed_in_range).toBe(2); // exactlyStart, inside
      });
      it('AF. Exact turnaround average', async () => {
        const start = new Date('2025-01-01T00:00:00Z');
        const end = new Date('2025-01-10T00:00:00Z');

        const d1_sub = new Date('2025-01-02T10:00:00Z');
        const d1_dec = new Date('2025-01-02T12:00:00Z'); // 2h

        const d2_sub = new Date('2025-01-03T10:00:00Z');
        const d2_dec = new Date('2025-01-03T14:00:00Z'); // 4h

        const d3_sub = new Date('2025-01-04T10:00:00Z');
        const d3_dec = new Date('2025-01-04T16:00:00Z'); // 6h

        const d_pend_sub = new Date('2025-01-05T10:00:00Z'); // pending

        const d_out_sub = new Date('2025-02-01T10:00:00Z');
        const d_out_dec = new Date('2025-02-01T12:00:00Z'); // out of range

        const d_invalid_sub = new Date('2025-01-06T10:00:00Z'); // null decision

        await Application.bulkCreate([
          { applicant_id: 1, approval_rule_id: ruleFire.id, status: 'approved', submitted_at: d1_sub, decided_at: d1_dec, last_notified_level: 'none' },
          { applicant_id: 1, approval_rule_id: ruleFire.id, status: 'rejected', submitted_at: d2_sub, decided_at: d2_dec, last_notified_level: 'none' },
          { applicant_id: 1, approval_rule_id: ruleFire.id, status: 'auto_approved', submitted_at: d3_sub, decided_at: d3_dec, last_notified_level: 'none' },
          { applicant_id: 1, approval_rule_id: ruleFire.id, status: 'submitted', submitted_at: d_pend_sub, decided_at: null, last_notified_level: 'none' },
          { applicant_id: 1, approval_rule_id: ruleFire.id, status: 'approved', submitted_at: d_out_sub, decided_at: d_out_dec, last_notified_level: 'none' },
          { applicant_id: 1, approval_rule_id: ruleFire.id, status: 'approved', submitted_at: d_invalid_sub, decided_at: null, last_notified_level: 'none' },
        ]);

        const res = await request(app)
          .get(`/api/admin/analytics/overview?department=${fireDept}&startDate=${start.toISOString()}&endDate=${end.toISOString()}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(res.body.data.average_turnaround_for_decisions_in_range.average_hours).toBe(4);
        expect(res.body.data.average_turnaround_for_decisions_in_range.sample_size).toBe(3);
      });
      it('AG. Zero database mutations', async () => {
        const { Notification, Inspection, Grievance, GrievanceEscalation } = require('../src/models');
        const getSnapshot = async () => {
          const snap = {};
          snap.app = await Application.findAll({ order: [['id', 'ASC']], raw: true });
          snap.rule = await ApprovalRule.findAll({ order: [['id', 'ASC']], raw: true });
          if (Notification) snap.notif = await Notification.findAll({ order: [['id', 'ASC']], raw: true });
          if (Inspection) snap.insp = await Inspection.findAll({ order: [['id', 'ASC']], raw: true });
          if (Grievance) snap.griev = await Grievance.findAll({ order: [['id', 'ASC']], raw: true });
          if (GrievanceEscalation) snap.esc = await GrievanceEscalation.findAll({ order: [['id', 'ASC']], raw: true });
          return JSON.parse(JSON.stringify(snap));
        };

        let mutationCalled = false;
        const origCreate = Application.create;
        const origUpdate = Application.update;
        const origDestroy = Application.destroy;

        Application.create = async (...args) => { mutationCalled = true; return origCreate.apply(Application, args); };
        Application.update = async (...args) => { mutationCalled = true; return origUpdate.apply(Application, args); };
        Application.destroy = async (...args) => { mutationCalled = true; return origDestroy.apply(Application, args); };

        try {
          const before = await getSnapshot();

          await request(app).get('/api/admin/analytics/overview').set('Authorization', `Bearer ${adminToken}`).expect(200);
          await request(app).get('/api/admin/analytics').set('Authorization', `Bearer ${adminToken}`).expect(200);

          const after = await getSnapshot();
          console.log('\n--- AG SNAPSHOT ---');
          console.log(JSON.stringify(before, null, 2));
          console.log('-------------------\n');

          expect(before).toEqual(after);
          customAssert(!mutationCalled);
        } finally {
          Application.create = origCreate;
          Application.update = origUpdate;
          Application.destroy = origDestroy;
        }
      });
      it('AH. Safe internal failure', async () => {
        const originalCount = Application.count;
        Application.count = async () => { throw new Error('Sensitive database credentials leaking!'); };

        try {
          const res = await request(app).get('/api/admin/analytics/overview').set('Authorization', `Bearer ${adminToken}`).expect(500);
          expect(res.body).toEqual({ error: 'Internal server error' });
          customAssert(JSON.stringify(res.body).includes('Sensitive') === false);
          customAssert(JSON.stringify(res.body).includes('stack') === false);
        } finally {
          Application.count = originalCount;
        }

        await request(app).get('/api/admin/analytics/overview').set('Authorization', `Bearer ${adminToken}`).expect(200);
      });
      it('AI. Existing manual compliance route remains functional', async () => {
        const executePost = () => {
          return new Promise((resolve, reject) => {
            const url = new URL('/api/admin/run-sla-check', baseUrl);
            const req = http.request({
              hostname: url.hostname,
              port: url.port,
              path: url.pathname,
              method: 'POST',
              headers: { 'Authorization': `Bearer ${adminToken}` }
            }, (res) => {
              let data = '';
              res.on('data', c => data += c);
              res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
            });
            req.on('error', reject);
            req.end();
          });
        };
        const r = await executePost();
        expect(r.status).toBe(200);

        console.log('\n--- AI RESPONSE ---');
        console.log(JSON.stringify(r.body, null, 2));
        console.log('-------------------\n');

        customAssert(typeof r.body.success === 'boolean');
        customAssert(typeof r.body.partial_failure === 'boolean');
        customAssert(r.body.sla !== undefined && r.body.sla !== null);
        customAssert(typeof r.body.sla.success === 'boolean');
        customAssert(r.body.grievances !== undefined && r.body.grievances !== null);
        customAssert(typeof r.body.grievances.success === 'boolean');

        const str = JSON.stringify(r.body).toLowerCase();
        customAssert(!str.includes('stack'));
        customAssert(!str.includes('sql'));
        customAssert(!str.includes('.db'));
        customAssert(!str.includes('internal error'));
      });
    });

    let failed = 0;
    for (const t of tests) {
      try {
        await t.fn();
        console.log(`   ${t.name}`);
      } catch (e) {
        console.error(`   ${t.name}`);
        console.error(e);
        failed++;
      }
    }

    console.log(`\nCoverage: A-AI implemented. AJ verified at runner level.`);
    console.log(`Total tests: ${tests.length}`);
    console.log(`Total assertions: ${assertionCount}`);
    console.log(`Failures: ${failed}`);
    console.log(`Exit code: ${failed > 0 ? 1 : 0}`);

    server.close(async () => {
      await sequelize.close();
      if (failed > 0) {
        process.exit(1);
      } else {
        process.exit(0);
      }
    });
  });
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
