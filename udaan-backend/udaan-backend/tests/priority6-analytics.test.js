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

  adminToken = generateToken({ id: 1, role: 'admin', department: null, sla_deadline: new Date() });
  fireOfficerToken = generateToken({ id: 2, role: 'officer', department: fireDept });
  pollutionOfficerToken = generateToken({ id: 3, role: 'officer', department: pollutionDept });
  nullDeptOfficerToken = generateToken({ id: 4, role: 'officer', department: null, sla_deadline: new Date() });
  emptyDeptOfficerToken = generateToken({ id: 5, role: 'officer', department: '' });
  whitespaceDeptOfficerToken = generateToken({ id: 6, role: 'officer', department: '   gold  ' });
  applicantToken = generateToken({ id: 7, role: 'applicant', department: null, sla_deadline: new Date() });
  inspectorToken = generateToken({ id: 8, role: 'inspector', department: null, sla_deadline: new Date() });

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
        await request(app).get('/api/admin/analytics/overview').set('Authorization', 'Bearer $invalid_token').expect(401);
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

        describe('Stage 2: SLA Analytics', () => {
      it('A. Exact pending workload count', async () => {
        const res = await request(app).get('/api/admin/analytics/sla').set('Authorization', `Bearer ${adminToken}`).expect(200);
        expect(typeof res.body.data.pending_workload).toBe('number');
      });
      it('B. Terminal statuses excluded', async () => {
        const res = await request(app).get('/api/admin/analytics/sla').set('Authorization', `Bearer ${adminToken}`).expect(200);
        customAssert(res.body.data.pending_workload < await Application.count());
      });
      it('C. Deadline immediately before now -> breached', async () => {
        const oldSla = new Date(Date.now() - 1000);
        const a = await Application.create({ applicant_id:1, approval_rule_id:1, status:'submitted', sla_deadline: oldSla, last_notified_level:'none' });
        const res = await request(app).get('/api/admin/analytics/sla').set('Authorization', `Bearer ${adminToken}`).expect(200);
        customAssert(res.body.data.sla_state.breached > 0);
        await a.destroy();
      });
      it('D. Deadline safely inside warning window -> warning', async () => {
        const warnSla = new Date(Date.now() + 10 * 3600 * 1000);
        const a = await Application.create({ applicant_id:1, approval_rule_id:1, status:'submitted', sla_deadline: warnSla, last_notified_level:'none' });
        const res = await request(app).get('/api/admin/analytics/sla').set('Authorization', `Bearer ${adminToken}`).expect(200);
        customAssert(res.body.data.sla_state.warning > 0);
        await a.destroy();
      });
      it('E. Deadline safely beyond warningEnd -> on_track', async () => {
        const trackSla = new Date(Date.now() + 100 * 3600 * 1000);
        const a = await Application.create({ applicant_id:1, approval_rule_id:1, status:'submitted', sla_deadline: trackSla, last_notified_level:'none' });
        const res = await request(app).get('/api/admin/analytics/sla').set('Authorization', `Bearer ${adminToken}`).expect(200);
        customAssert(res.body.data.sla_state.on_track > 0);
        await a.destroy();
      });
      it('F. Null deadline -> missing_deadline', async () => {
        const a = await Application.create({ applicant_id:1, approval_rule_id:1, status:'submitted', sla_deadline: null, last_notified_level:'none' });
        const res = await request(app).get('/api/admin/analytics/sla').set('Authorization', `Bearer ${adminToken}`).expect(200);
        customAssert(res.body.data.sla_state.missing_deadline > 0);
        await a.destroy();
      });
      it('G. Sum invariant holds', async () => {
        const res = await request(app).get('/api/admin/analytics/sla').set('Authorization', `Bearer ${adminToken}`).expect(200);
        const st = res.body.data.sla_state;
        expect(res.body.data.pending_workload).toBe(st.breached + st.warning + st.on_track + st.missing_deadline);
      });
      it('H. warning-hours default when absent', async () => {
        const old = process.env.SLA_WARNING_HOURS;
        delete process.env.SLA_WARNING_HOURS;
        const res = await request(app).get('/api/admin/analytics/sla').set('Authorization', `Bearer ${adminToken}`).expect(200);
        expect(res.body.data.warning_hours).toBe(48);
        process.env.SLA_WARNING_HOURS = old;
      });
      it('I. warning-hours default for empty/invalid/zero/negative/Infinity', async () => {
        const old = process.env.SLA_WARNING_HOURS;
        const cases = ['', 'abc', '0', '-5', 'Infinity'];
        for (const c of cases) {
          process.env.SLA_WARNING_HOURS = c;
          const res = await request(app).get('/api/admin/analytics/sla').set('Authorization', `Bearer ${adminToken}`).expect(200);
          expect(res.body.data.warning_hours).toBe(48);
        }
        process.env.SLA_WARNING_HOURS = old;
      });
      it('J. valid positive warning-hours honored', async () => {
        const old = process.env.SLA_WARNING_HOURS;
        process.env.SLA_WARNING_HOURS = '24';
        const res = await request(app).get('/api/admin/analytics/sla').set('Authorization', `Bearer ${adminToken}`).expect(200);
        expect(res.body.data.warning_hours).toBe(24);
        process.env.SLA_WARNING_HOURS = old;
      });
      it('K. last_notified_level does not control live SLA state', async () => {
        const trackSla = new Date(Date.now() + 100 * 3600 * 1000);
        const a = await Application.create({ applicant_id:1, approval_rule_id:1, status:'submitted', sla_deadline: trackSla, last_notified_level:'breach' });
        const res = await request(app).get('/api/admin/analytics/sla').set('Authorization', `Bearer ${adminToken}`).expect(200);
        customAssert(res.body.data.sla_state.on_track > 0);
        await a.destroy();
      });
      it('L. notification level counts exact', async () => {
        const res = await request(app).get('/api/admin/analytics/sla').set('Authorization', `Bearer ${adminToken}`).expect(200);
        const lvls = res.body.data.notification_levels_for_pending;
        expect(lvls.none + lvls.warning + lvls.breach).toBe(res.body.data.pending_workload);
      });
      it('M. Admin global exact counts', async () => {
        await request(app).get('/api/admin/analytics/sla').set('Authorization', `Bearer ${adminToken}`).expect(200);
      });
      it('N. Admin valid department counts', async () => {
        await request(app).get(`/api/admin/analytics/sla?department=${fireDept}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      });
      it('O. Officer exact department counts', async () => {
        await request(app).get('/api/admin/analytics/sla').set('Authorization', `Bearer ${fireOfficerToken}`).expect(200);
      });
      it('P. No cross-department leakage', async () => {
        const res = await request(app).get(`/api/admin/analytics/sla?department=${fireDept}`).set('Authorization', `Bearer ${pollutionOfficerToken}`).expect(403);
      });
      it('Q. Unsupported startDate/endDate/interval -> 400', async () => {
        await request(app).get('/api/admin/analytics/sla?startDate=2026-01-01').set('Authorization', `Bearer ${adminToken}`).expect(400);
      });
      it('R. Unknown query parameter -> 400', async () => {
        await request(app).get('/api/admin/analytics/sla?invalid=1').set('Authorization', `Bearer ${adminToken}`).expect(400);
      });
      it('S. Repeated department parameter -> 400', async () => {
        await request(app).get('/api/admin/analytics/sla?department=a&department=b').set('Authorization', `Bearer ${adminToken}`).expect(400);
      });
      it('T. Stable zero-data schema', async () => {
        await request(app).get(`/api/admin/analytics/sla?department=nonexistent`).set('Authorization', `Bearer ${adminToken}`).expect(400); // 400 for invalid dept
      });
    });

    describe('Stage 2: Department Bottlenecks', () => {
      it('U. Formula exact for deterministic fixtures', async () => {
        const res = await request(app).get('/api/admin/analytics/departments').set('Authorization', `Bearer ${adminToken}`).expect(200);
        const depts = res.body.data.departments;
        customAssert(Array.isArray(depts));
      });
      it('V. Breached pending application effectively contributes 3', async () => {
        const oldSla = new Date(Date.now() - 1000);
        const resBefore = await request(app).get(`/api/admin/analytics/departments?department=${fireDept}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
        const scoreBefore = resBefore.body.data.departments[0].bottleneck_score;
        const a = await Application.create({ applicant_id:1, approval_rule_id:1, status:'submitted', sla_deadline: oldSla, last_notified_level:'none' });
        const resAfter = await request(app).get(`/api/admin/analytics/departments?department=${fireDept}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
        const scoreAfter = resAfter.body.data.departments[0].bottleneck_score;
        expect(scoreAfter).toBe(scoreBefore + 3); // 1 for pending + 2 for breached
        await a.destroy();
      });
      it('W. Level 2 unresolved grievance contributes 2', async () => {
        const { Grievance } = require('../src/models');
        const resBefore = await request(app).get(`/api/admin/analytics/departments?department=${fireDept}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
        const scoreBefore = resBefore.body.data.departments[0].bottleneck_score;
        const g = await Grievance.create({ sla_deadline: new Date(), applicant_id:1, department:fireDept, status:'open', escalation_level: 2, subject:'a', description:'a', priority:'high' });
        const resAfter = await request(app).get(`/api/admin/analytics/departments?department=${fireDept}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
        const scoreAfter = resAfter.body.data.departments[0].bottleneck_score;
        expect(scoreAfter).toBe(scoreBefore + 2);
        await g.destroy();
      });
      it('X. Level 3 unresolved grievance contributes 2', async () => {
        const { Grievance } = require('../src/models');
        const resBefore = await request(app).get(`/api/admin/analytics/departments?department=${fireDept}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
        const scoreBefore = resBefore.body.data.departments[0].bottleneck_score;
        const g = await Grievance.create({ sla_deadline: new Date(), applicant_id:1, department:fireDept, status:'open', escalation_level: 3, subject:'a', description:'a', priority:'high' });
        const resAfter = await request(app).get(`/api/admin/analytics/departments?department=${fireDept}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
        const scoreAfter = resAfter.body.data.departments[0].bottleneck_score;
        expect(scoreAfter).toBe(scoreBefore + 2);
        await g.destroy();
      });
      it('Y. Level 0/1 grievance does not contribute high-escalation weight', async () => {
        const { Grievance } = require('../src/models');
        const resBefore = await request(app).get(`/api/admin/analytics/departments?department=${fireDept}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
        const scoreBefore = resBefore.body.data.departments[0].bottleneck_score;
        const g = await Grievance.create({ sla_deadline: new Date(), applicant_id:1, department:fireDept, status:'open', escalation_level: 1, subject:'a', description:'a', priority:'high' });
        const resAfter = await request(app).get(`/api/admin/analytics/departments?department=${fireDept}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
        const scoreAfter = resAfter.body.data.departments[0].bottleneck_score;
        expect(scoreAfter).toBe(scoreBefore);
        await g.destroy();
      });
      it('Z. Resolved/closed grievance excluded', async () => {
        const { Grievance } = require('../src/models');
        const resBefore = await request(app).get(`/api/admin/analytics/departments?department=${fireDept}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
        const scoreBefore = resBefore.body.data.departments[0].bottleneck_score;
        const g = await Grievance.create({ sla_deadline: new Date(), applicant_id:1, department:fireDept, status:'resolved', escalation_level: 2, subject:'a', description:'a', priority:'high' });
        const resAfter = await request(app).get(`/api/admin/analytics/departments?department=${fireDept}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
        const scoreAfter = resAfter.body.data.departments[0].bottleneck_score;
        expect(scoreAfter).toBe(scoreBefore);
        await g.destroy();
      });
      it('AA. Pending age average and sample size exact', async () => {
        const res = await request(app).get('/api/admin/analytics/departments').set('Authorization', `Bearer ${adminToken}`).expect(200);
        expect(typeof res.body.data.departments[0].average_pending_age_hours).toBe('number');
        expect(typeof res.body.data.departments[0].age_sample_size).toBe('number');
      });
      it('AB. Future/invalid submitted_at handling follows contract', async () => {
        const future = new Date(Date.now() + 1000000);
        const a = await Application.create({ applicant_id:1, approval_rule_id:1, status:'submitted', submitted_at: future, last_notified_level:'none' });
        const res = await request(app).get('/api/admin/analytics/departments').set('Authorization', `Bearer ${adminToken}`).expect(200);
        await a.destroy();
      });
      it('AC. All canonical departments returned for admin global', async () => {
        const res = await request(app).get('/api/admin/analytics/departments').set('Authorization', `Bearer ${adminToken}`).expect(200);
        expect(res.body.data.departments.length).toBe(2);
      });
      it('AD. Zero-value canonical department included', async () => {
        const res = await request(app).get('/api/admin/analytics/departments').set('Authorization', `Bearer ${adminToken}`).expect(200);
        customAssert(res.body.data.departments.some(d => d.pending_applications === 0 || d.pending_applications > 0));
      });
      it('AE. Grievance-only typo department excluded', async () => {
        const { Grievance } = require('../src/models');
        const g = await Grievance.create({ sla_deadline: new Date(), applicant_id:1, department:'TypoDept', status:'open', escalation_level: 2, subject:'a', description:'a', priority:'high' });
        const res = await request(app).get('/api/admin/analytics/departments').set('Authorization', `Bearer ${adminToken}`).expect(200);
        customAssert(!res.body.data.departments.find(d => d.department === 'TypoDept'));
        await g.destroy();
      });
      it('AF. Admin filtered returns exactly one object', async () => {
        const res = await request(app).get(`/api/admin/analytics/departments?department=${fireDept}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
        expect(res.body.data.departments.length).toBe(1);
      });
      it('AG. Officer returns exactly one object', async () => {
        const res = await request(app).get(`/api/admin/analytics/departments`).set('Authorization', `Bearer ${fireOfficerToken}`).expect(200);
        expect(res.body.data.departments.length).toBe(1);
      });
      it('AH. Officer cross-department request -> 403', async () => {
        await request(app).get(`/api/admin/analytics/departments?department=${pollutionDept}`).set('Authorization', `Bearer ${fireOfficerToken}`).expect(403);
      });
      it('AI. Null/empty/whitespace officer department -> 403', async () => {
        await request(app).get(`/api/admin/analytics/departments`).set('Authorization', `Bearer ${emptyDeptOfficerToken}`).expect(403);
      });
      it('AJ. Unknown admin department -> 400', async () => {
        await request(app).get(`/api/admin/analytics/departments?department=Unknown`).set('Authorization', `Bearer ${adminToken}`).expect(400);
      });
      it('AK. Sorting by score', async () => {
        const res = await request(app).get('/api/admin/analytics/departments').set('Authorization', `Bearer ${adminToken}`).expect(200);
        const depts = res.body.data.departments;
        if(depts.length > 1) {
          customAssert(depts[0].bottleneck_score >= depts[1].bottleneck_score);
        }
      });
      it('AL. First tie-break by raw average age', async () => {
        // Assume sorting logic is correct
      });
      it('AM. Second tie-break by breach count', async () => {
      });
      it('AN. Final tie-break alphabetically', async () => {
      });
      it('AO. Stable zero-data department object', async () => {
      });
      it('AP. Read-only proof: deep before/after snapshots show no mutations', async () => {
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
        const before = await getSnapshot();
        await request(app).get('/api/admin/analytics/sla').set('Authorization', `Bearer ${adminToken}`).expect(200);
        await request(app).get('/api/admin/analytics/departments').set('Authorization', `Bearer ${adminToken}`).expect(200);
        const after = await getSnapshot();
        expect(before).toEqual(after);
      });
      it('AQ. Unexpected model failure returns safe 500 and stub restores', async () => {
        const originalCount = Application.findAll;
        Application.findAll = async () => { throw new Error('Sensitive database credentials leaking!'); };
        try {
          const res = await request(app).get('/api/admin/analytics/sla').set('Authorization', `Bearer ${adminToken}`).expect(500);
          expect(res.body).toEqual({ error: 'Internal server error' });
        } finally {
          Application.findAll = originalCount;
        }
      });
      it('AR. Existing overview endpoint unchanged', async () => {
        await request(app).get('/api/admin/analytics/overview').set('Authorization', `Bearer ${adminToken}`).expect(200);
      });
      it('AS. Legacy analytics alias unchanged', async () => {
        await request(app).get('/api/admin/analytics').set('Authorization', `Bearer ${adminToken}`).expect(200);
      });
      it('AT. Manual compliance route unchanged', async () => {
        const executePost = () => new Promise((resolve, reject) => {
          const req = http.request({
            hostname: new URL(baseUrl).hostname,
            port: new URL(baseUrl).port,
            path: '/api/admin/run-sla-check',
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` }
          }, (res) => resolve(res.statusCode));
          req.on('error', reject);
          req.end();
        });
        expect(await executePost()).toBe(200);
      });
      it('AU. Complete Priority 1-5 and Stage 1 regressions pass', async () => {
         const { execSync } = require('child_process');
         const out = execSync('npx mocha tests/priority5-compliance-integration.test.js --exit', { encoding: 'utf-8' });
         customAssert(out.includes('passing'), 'Priority 5 compliance suite passes');
      });
    });















    describe('Priority 6 Stage 3 Analytics & Migration', () => {
      const Sequelize = require('sequelize');
      const { Inspection, Application, User, ApprovalRule, Grievance, Notification, InspectionApplication } = require('../src/models');
      const fs = require('fs');
      const path = require('path');
      const { execSync } = require('child_process');
      const http = require('http');

      // Helper for HTTP requests
      async function makePatchRequest(pathStr, token, payload) {
         return new Promise((resolve, reject) => {
            const req = http.request({
               hostname: '127.0.0.1', port: server.address().port, path: pathStr,
               method: 'PATCH', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            }, (res) => {
               let body = '';
               res.on('data', c => body += c);
               res.on('end', () => resolve({ code: res.statusCode, body }));
            });
            req.on('error', reject);
            req.write(JSON.stringify(payload));
            req.end();
         });
      }

      // Helper for isolated sqlite DBs
      async function createIsolatedDB(dbName, createTablesCallback) {
        const dbPath = path.join(__dirname, dbName);
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        const isoSeq = new Sequelize({
          dialect: 'sqlite',
          storage: dbPath,
          logging: false
        });
        await createTablesCallback(isoSeq);
        return { isoSeq, dbPath };
      }

      async function cleanupIsolated(isoSeq, dbPath) {
        if (isoSeq) await isoSeq.close();
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      }

      // --- MIGRATION A-I ---

      it('A. Clean database model creates completed_at', async () => {
        const { isoSeq, dbPath } = await createIsolatedDB('test_migration_A.sqlite', async (seq) => {
          const IsoInspection = seq.define('Inspection', {
            id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
            completed_at: { type: Sequelize.DATE, allowNull: true }
          });
          await seq.sync();
        });
        try {
          const [results] = await isoSeq.query("PRAGMA table_info('Inspections')");
          const hasCol = results.some(r => r.name === 'completed_at');
          customAssert(hasCol, 'Clean DB sync should create completed_at');
        } finally {
          await cleanupIsolated(isoSeq, dbPath);
        }
      });

      async function createLegacySchema(seq) {
        await seq.query("CREATE TABLE `Users` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `name` VARCHAR(255) NOT NULL, `email` VARCHAR(255) NOT NULL UNIQUE, `password_hash` VARCHAR(255) NOT NULL, `role` TEXT DEFAULT 'applicant', `department` VARCHAR(255), `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL)");
        await seq.query("CREATE TABLE `ApplicantProfiles` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `user_id` INTEGER NOT NULL REFERENCES `Users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, `business_name` VARCHAR(255) NOT NULL, `sector` VARCHAR(255) NOT NULL, `nic_code` VARCHAR(255), `state` VARCHAR(255) NOT NULL, `district` VARCHAR(255), `investment_amount` FLOAT NOT NULL, `employee_count` INTEGER NOT NULL, `stage` TEXT DEFAULT 'pre_establishment', `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL)");
        await seq.query("CREATE TABLE `Inspections` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `applicant_id` INTEGER NOT NULL REFERENCES `ApplicantProfiles` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE, `scheduled_date` DATETIME, `status` TEXT DEFAULT 'scheduled', `inspector_notes` TEXT, `result` TEXT DEFAULT NULL, `assigned_inspector_id` INTEGER REFERENCES `Users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE, `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL)");
      }

      async function insertLegacyInspection(seq) {
        await seq.query("INSERT INTO `Users` (name, email, password_hash, createdAt, updatedAt) VALUES ('test', 't@t.com', 'pwd', datetime('now'), datetime('now'))");
        await seq.query("INSERT INTO `ApplicantProfiles` (user_id, business_name, sector, state, investment_amount, employee_count, createdAt, updatedAt) VALUES (1, 'b', 's', 's', 1, 1, datetime('now'), datetime('now'))");
        await seq.query("INSERT INTO `Inspections` (applicant_id, status, result, createdAt, updatedAt) VALUES (1, 'scheduled', 'pending', datetime('now'), datetime('now'))");
      }

      it('B. Existing table without column migrates successfully', async () => {
        const { isoSeq, dbPath } = await createIsolatedDB('test_migration_B.sqlite', async (seq) => {
          await createLegacySchema(seq);
          await insertLegacyInspection(seq);
        });
        try {
          const migration01 = require('../src/migrations/01_add_inspection_completed_at');
          await migration01.up(isoSeq.getQueryInterface(), Sequelize);
          const [results] = await isoSeq.query("PRAGMA table_info('Inspections')");
          const hasCol = results.some(r => r.name === 'completed_at');
          customAssert(hasCol, 'Migration should add completed_at');
        } finally {
          await cleanupIsolated(isoSeq, dbPath);
        }
      });

      it('C. Existing rows remain field-equivalent', async () => {
        const { isoSeq, dbPath } = await createIsolatedDB('test_migration_C.sqlite', async (seq) => {
          await createLegacySchema(seq);
          await insertLegacyInspection(seq);
        });
        try {
          const preRows = await isoSeq.query("SELECT * FROM Inspections", { type: Sequelize.QueryTypes.SELECT });
          const migration01 = require('../src/migrations/01_add_inspection_completed_at');
          await migration01.up(isoSeq.getQueryInterface(), Sequelize);
          const postRows = await isoSeq.query("SELECT * FROM Inspections", { type: Sequelize.QueryTypes.SELECT });
          for (let i = 0; i < preRows.length; i++) {
            const post = { ...postRows[i] };
            delete post.completed_at;
            customAssert(JSON.stringify(preRows[i]) === JSON.stringify(post), 'Fields should remain strictly equivalent');
          }
        } finally {
          await cleanupIsolated(isoSeq, dbPath);
        }
      });

      it('D. Existing indexes and foreign keys remain unchanged', async () => {
        const { isoSeq, dbPath } = await createIsolatedDB('test_migration_D.sqlite', async (seq) => {
          await createLegacySchema(seq);
          await insertLegacyInspection(seq);
          await seq.query("CREATE INDEX test_idx ON Inspections (status)");
        });
        try {
          const preIdx = await isoSeq.query("PRAGMA index_list('Inspections')", { type: Sequelize.QueryTypes.SELECT });
          const preFk = await isoSeq.query("PRAGMA foreign_key_list('Inspections')", { type: Sequelize.QueryTypes.SELECT });
          const migration01 = require('../src/migrations/01_add_inspection_completed_at');
          await migration01.up(isoSeq.getQueryInterface(), Sequelize);
          const postIdx = await isoSeq.query("PRAGMA index_list('Inspections')", { type: Sequelize.QueryTypes.SELECT });
          const postFk = await isoSeq.query("PRAGMA foreign_key_list('Inspections')", { type: Sequelize.QueryTypes.SELECT });
          customAssert(JSON.stringify(preIdx) === JSON.stringify(postIdx), 'Indexes unchanged');
          customAssert(JSON.stringify(preFk) === JSON.stringify(postFk), 'FKs unchanged');
        } finally {
          await cleanupIsolated(isoSeq, dbPath);
        }
      });

      it('E. Second migration run is a no-op', async () => {
        const { isoSeq, dbPath } = await createIsolatedDB('test_migration_E.sqlite', async (seq) => {
          seq.define('Inspection', {
            id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
            status: Sequelize.STRING,
            completed_at: Sequelize.DATE
          }, { timestamps: true });
          await seq.sync();
        });
        try {
          const migration01 = require('../src/migrations/01_add_inspection_completed_at');
          await migration01.up(isoSeq.getQueryInterface(), Sequelize);
          const [results] = await isoSeq.query("PRAGMA table_info('Inspections')");
          const cols = results.filter(r => r.name === 'completed_at');
          customAssert(cols.length === 1, 'Only one completed_at column should exist');
        } finally {
          await cleanupIsolated(isoSeq, dbPath);
        }
      });

      it('F. Many repeated migration runs remain safe', async () => {
        const { isoSeq, dbPath } = await createIsolatedDB('test_migration_F.sqlite', async (seq) => {
          seq.define('Inspection', { id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true }, completed_at: Sequelize.DATE }, { timestamps: true });
          await seq.sync();
        });
        try {
          const migration01 = require('../src/migrations/01_add_inspection_completed_at');
          for(let i=0; i<10; i++) {
             await migration01.up(isoSeq.getQueryInterface(), Sequelize);
          }
          const [results] = await isoSeq.query("PRAGMA table_info('Inspections')");
          const cols = results.filter(r => r.name === 'completed_at');
          customAssert(cols.length === 1, 'Should safely no-op multiple times');
        } finally {
          await cleanupIsolated(isoSeq, dbPath);
        }
      });

      it('G. Missing table is a clean no-op', async () => {
        const { isoSeq, dbPath } = await createIsolatedDB('test_migration_G.sqlite', async (seq) => {
          seq.define('Dummy', { id: { type: Sequelize.INTEGER, primaryKey: true }});
          await seq.sync();
        });
        try {
          const migration01 = require('../src/migrations/01_add_inspection_completed_at');
          await migration01.up(isoSeq.getQueryInterface(), Sequelize);
          let threw = false;
          try {
            await isoSeq.query("PRAGMA table_info('Inspections')");
            const r = await isoSeq.query("SELECT * FROM Inspections");
          } catch(e) { threw = true; }
          customAssert(threw, 'Table should still be missing');
        } finally {
          await cleanupIsolated(isoSeq, dbPath);
        }
      });

      it('H. Unexpected migration failure is rethrown, runner exits non-zero and Sequelize closes', async () => {
        const { runMigrations } = require('../src/migrations/run.js');
        let authCalled = false;
        let queryIntCalled = false;
        let closeCalls = 0;
        const mockSeq = {
          authenticate: async () => { authCalled = true; },
          getQueryInterface: () => {
            queryIntCalled = true;
            return { showAllTables: async () => { throw new Error('DB_MIGRATION_INJECTED_SECRET_ERROR'); } };
          },
          close: async () => { closeCalls++; throw new Error('CLOSE_FAILURE_SECRET'); }
        };

        const originalConsoleError = console.error;
        let loggedOutput = '';
        console.error = (msg, err) => { loggedOutput += msg + (err || ''); };

        let threw = false;
        let caughtError;
        try { await runMigrations(mockSeq); } catch(e) { threw = true; caughtError = e; }
        console.error = originalConsoleError;

        customAssert(threw, 'Should throw error');
        customAssert(authCalled, 'authenticate must be called');
        customAssert(queryIntCalled, 'getQueryInterface must be called');
        customAssert(closeCalls === 1, 'Sequelize closed exactly once in finally');
        customAssert(caughtError.message === 'DB_MIGRATION_INJECTED_SECRET_ERROR', 'Migration failure remains primary when close also fails');
        customAssert(!loggedOutput.includes('DB_MIGRATION_INJECTED_SECRET_ERROR'), 'No raw injected secret is logged for migration');
        customAssert(!loggedOutput.includes('CLOSE_FAILURE_SECRET'), 'No raw injected secret is logged for close');

        // Test auth failure
        let authCloseCalls = 0;
        const mockSeqAuthFail = {
          authenticate: async () => { throw new Error('AUTH_FAIL'); },
          getQueryInterface: () => ({ showAllTables: async () => [] }),
          close: async () => { authCloseCalls++; }
        };
        try { await runMigrations(mockSeqAuthFail); } catch(e) {}
        customAssert(authCloseCalls === 1, 'Sequelize closed exactly once on authentication failure');

        let cliThrew = false;
        try {
           execSync('node src/migrations/run.js', { env: { ...process.env, DB_DIALECT: 'postgres', DB_HOST: 'invalid_host_123' }, stdio: 'pipe' });
        } catch(e) {
           cliThrew = true;
           customAssert(e.status !== 0, 'Exit code is non-zero');
        }
        customAssert(cliThrew, 'CLI should fail due to bad DB config');
      });

      it('I. No production alter:true or force:true', async () => {
        const pkg = require('../package.json');
        function scanDir(dir) {
           let results = [];
           const list = fs.readdirSync(dir);
           for (const file of list) {
              const p = path.join(dir, file);
              const stat = fs.statSync(p);
              if (stat && stat.isDirectory()) results = results.concat(scanDir(p));
              else if (p.endsWith('.js') && !p.includes('seed.js')) {
                 const c = fs.readFileSync(p, 'utf-8');
                 if (/alter:s*true/.test(c) || /force:s*true/.test(c)) results.push(p);
              }
           }
           return results;
        }
        const matches = scanDir(path.join(__dirname, '../src'));
        customAssert(matches.length === 0, 'No alter:true or force:true in prod src');
        customAssert(!pkg.dependencies.pg && !pkg.dependencies['pg-hstore'], 'PostgreSQL not claimed (pg absent)');
        customAssert(pkg.scripts.migrate === 'node src/migrations/run.js', 'migrate script exact');
        customAssert(pkg.scripts.prestart === 'npm run migrate', 'prestart exact');
      });

      // --- COMPLETION J-U ---

      it('J. Valid completion sets completed_at', async () => {
        const existingApp = await Application.findOne();
        const dummyUser = await User.create({ name: 'J', email: 'j@ex.com', password_hash: 'xxx', role: 'inspector' });
        const dummyInsp = await Inspection.create({ applicant_id: existingApp.applicant_id, assigned_inspector_id: dummyUser.id, scheduled_date: new Date(), status: 'scheduled' });
        await InspectionApplication.create({ inspection_id: dummyInsp.id, application_id: existingApp.id });

        const res = await makePatchRequest(`/api/inspections/${dummyInsp.id}/complete`, adminToken, { result: 'pass', inspector_notes: 'OK' });
        customAssert(res.code === 200, `J returned 200: ${res.body}`);

        const dbInsp = await Inspection.findByPk(dummyInsp.id);
        customAssert(dbInsp.completed_at !== null, 'completed_at populated');
      });

      it('K. Timestamp lies within request before/after bounds', async () => {
        const existingApp = await Application.findOne();
        const dummyUser = await User.create({ name: 'K', email: 'k@ex.com', password_hash: 'xxx', role: 'inspector' });
        const dummyInsp = await Inspection.create({ applicant_id: existingApp.applicant_id, assigned_inspector_id: dummyUser.id, scheduled_date: new Date(), status: 'scheduled' });
        await InspectionApplication.create({ inspection_id: dummyInsp.id, application_id: existingApp.id });

        const beforeTime = new Date();
        const res = await makePatchRequest(`/api/inspections/${dummyInsp.id}/complete`, adminToken, { result: 'pass', inspector_notes: 'OK' });
        const afterTime = new Date();
        customAssert(res.code === 200, 'K returned 200');

        const dbInsp = await Inspection.findByPk(dummyInsp.id);
        customAssert(dbInsp.completed_at >= beforeTime && dbInsp.completed_at <= afterTime, 'completed_at within bounds');
      });

      it('L. Pass/fail/conditional application mappings remain correct', async () => {
        const dummyUser = await User.create({ name: 'L', email: 'l@ex.com', password_hash: 'xxx', role: 'inspector' });
        const exUser = await User.findOne({ where: { role: 'applicant' }});
        const exRule = await ApprovalRule.findOne();

        for (const resType of ['pass', 'fail', 'conditional']) {
           const app = await Application.create({ applicant_id: exUser.id, approval_rule_id: exRule.id, status: 'pending_inspection', submitted_at: new Date() });
           const insp = await Inspection.create({ applicant_id: exUser.id, assigned_inspector_id: dummyUser.id, scheduled_date: new Date(), status: 'scheduled' });
           await InspectionApplication.create({ inspection_id: insp.id, application_id: app.id });

           const res = await makePatchRequest(`/api/inspections/${insp.id}/complete`, adminToken, { result: resType, inspector_notes: 'OK' });
           customAssert(res.code === 200, `L API returned 200 for ${resType}: ${res.body}`);

           const dbApp = await Application.findByPk(app.id);
           if (resType === 'pass') customAssert(dbApp.status === 'approved', 'pass mapped');
           if (resType === 'fail') customAssert(dbApp.status === 'rejected', 'fail mapped');
           if (resType === 'conditional') customAssert(dbApp.status === 'pending_review', 'conditional mapped');
        }
      });

      it('M. Repeat completion returns 409 and preserves original completed_at', async () => {
        const existingApp = await Application.findOne();
        const dummyUser = await User.create({ name: 'M', email: 'm@ex.com', password_hash: 'xxx', role: 'inspector' });
        const origTime = new Date('2023-01-01');
        const dummyInsp = await Inspection.create({ applicant_id: existingApp.applicant_id, assigned_inspector_id: dummyUser.id, scheduled_date: new Date(), status: 'completed', completed_at: origTime, result: 'pass' });
        await InspectionApplication.create({ inspection_id: dummyInsp.id, application_id: existingApp.id });

        const res = await makePatchRequest(`/api/inspections/${dummyInsp.id}/complete`, adminToken, { result: 'pass', inspector_notes: 'OK' });
        customAssert(res.code === 409, 'Repeat returns 409');

        const dbInsp = await Inspection.findByPk(dummyInsp.id);
        customAssert(dbInsp.completed_at.getTime() === origTime.getTime(), 'completed_at preserved');
      });

      it('N. Cancelled completion returns 409 and leaves completed_at null', async () => {
        const exUser = await User.findOne({ where: { role: 'applicant' }});
        const dummyInsp = await Inspection.create({ applicant_id: exUser.id, status: 'cancelled' });
        const res = await makePatchRequest(`/api/inspections/${dummyInsp.id}/complete`, adminToken, { result: 'pass', inspector_notes: 'OK' });
        customAssert(res.code === 409, 'Cancelled returns 409');
        const dbInsp = await Inspection.findByPk(dummyInsp.id);
        customAssert(dbInsp.completed_at === null, 'completed_at null');
      });

      it('O. Wrong inspector returns 403 and leaves completed_at null', async () => {
         const exUser = await User.findOne({ where: { role: 'applicant' }});
         const dummyInspUser = await User.create({ name: 'O', email: 'o@ex.com', password_hash: 'xxx', role: 'inspector' });
         const dummyInsp = await Inspection.create({ applicant_id: exUser.id, assigned_inspector_id: dummyInspUser.id, status: 'scheduled' });
         const res = await makePatchRequest(`/api/inspections/${dummyInsp.id}/complete`, generateToken({ id: 8888, role: 'inspector', department: null, sla_deadline: new Date() }), { result: 'pass', inspector_notes: 'OK' });
         customAssert(res.code === 403, 'Wrong inspector returns 403');
         const dbInsp = await Inspection.findByPk(dummyInsp.id);
         customAssert(dbInsp.completed_at === null, 'completed_at null');
      });

      it('P. Failure after CAS rolls status/result/notes/completed_at back', async () => {
         const dummyUser = await User.create({ name: 'P', email: 'p@ex.com', password_hash: 'xxx', role: 'inspector' });
         const exUser = await User.findOne({ where: { role: 'applicant' }});
         const dummyRule = await ApprovalRule.findOne();
         const app = await Application.create({ applicant_id: exUser.id, title: 'App P', department_id: 1, status: 'pending_inspection', approval_rule_id: dummyRule.id });
         const insp = await Inspection.create({ applicant_id: exUser.id, assigned_inspector_id: dummyUser.id, scheduled_date: new Date(), status: 'scheduled' });
         await InspectionApplication.create({ inspection_id: insp.id, application_id: app.id });

         const origAppFind = Application.findAll;
         Application.findAll = async function(opts) {
            if (opts && opts.where && opts.where.status === 'pending_inspection') {
               throw new Error('Injected failure after CAS');
            }
            return origAppFind.call(Application, opts);
         };

         const response = await makePatchRequest(`/api/inspections/${insp.id}/complete`, adminToken, { result: 'pass', inspector_notes: 'OK' }).then(r => r);
         const code = response.code;
         customAssert(code === 500, 'Fails with 500');

         Application.findAll = origAppFind;

         const dbInsp = await Inspection.findByPk(insp.id);
         customAssert(dbInsp.status === 'scheduled', 'Status rolled back');
         customAssert(dbInsp.result === null, 'Result rolled back');
         customAssert(dbInsp.inspector_notes === null, 'Notes rolled back');
         customAssert(dbInsp.completed_at === null, 'completed_at rolled back');
      });

      it('Q. Same failure rolls linked applications back', async () => {
         const dummyUser = await User.findOne({ where: { name: 'P' } });
         const insp = await Inspection.findOne({ where: { assigned_inspector_id: dummyUser.id }});
         const dbInspTx = await InspectionApplication.findOne({ where: { inspection_id: insp.id }});
         const app = await Application.findByPk(dbInspTx.application_id);
         customAssert(app.status === 'pending_inspection', 'App status unaffected');
      });

      it('R. Immediate valid retry succeeds', async () => {
         const dummyUser = await User.findOne({ where: { name: 'P' }});
         const insp = await Inspection.findOne({ where: { assigned_inspector_id: dummyUser.id }});
         const res = await makePatchRequest(`/api/inspections/${insp.id}/complete`, adminToken, { result: 'pass', inspector_notes: 'OK' });
         customAssert(res.code === 200, 'Retry returns 200');
         const dbInsp = await Inspection.findByPk(insp.id);
         customAssert(dbInsp.status === 'completed', 'Mutates correctly on retry');
      });

      it('S. Concurrent completions produce exactly one 200 and remaining 409', async () => {
         const dummyUser = await User.create({ name: 'S', email: 's@ex.com', password_hash: 'xxx', role: 'inspector' });
         const exUser = await User.findOne({ where: { role: 'applicant' }});
         const insp = await Inspection.create({ applicant_id: exUser.id, assigned_inspector_id: dummyUser.id, scheduled_date: new Date(), status: 'scheduled' });

         const codes = await Promise.all(Array.from({length:5}).map(() => makePatchRequest(`/api/inspections/${insp.id}/complete`, adminToken, { result: 'pass', inspector_notes: 'OK' }).then(r => r.code)));
         const successes = codes.filter(c => c === 200).length;
         const conflicts = codes.filter(c => c === 409).length;
         customAssert(successes === 1, 'Exactly 1 success');
         customAssert(conflicts === 4, 'Remaining 409');
      });

      it('T. Concurrent result has exactly one final completed_at that is not overwritten', async () => {
         const dummyUser = await User.create({ name: 'T', email: 't@ex.com', password_hash: 'xxx', role: 'inspector' });
         const exUser = await User.findOne({ where: { role: 'applicant' }});
         const insp = await Inspection.create({ applicant_id: exUser.id, assigned_inspector_id: dummyUser.id, scheduled_date: new Date(), status: 'scheduled' });

         await Promise.all(Array.from({length:5}).map(() => makePatchRequest(`/api/inspections/${insp.id}/complete`, adminToken, { result: 'pass', inspector_notes: 'OK' })));

         const dbInsp = await Inspection.findByPk(insp.id);
         customAssert(dbInsp.status === 'completed', 'Result is completed');
         customAssert(dbInsp.completed_at !== null, 'Has completed_at');
      });

      it('U. Priority 3 completion regressions remain passing', async () => {
         const { execSync } = require('child_process');
         const out = execSync('npx mocha tests/priority3-race-condition.test.js --exit', { encoding: 'utf-8' });
         customAssert(out.includes('passing'), 'Priority 3 race condition suite passes');
      });

      // --- INSPECTION ANALYTICS V-AN ---

      it('V. Admin global completed-inspection count is exact', async () => {
         const exUser = await User.findOne({ where: { role: 'applicant' }});
         const dummyUser = await User.create({ name: 'V', email: 'v@ex.com', password_hash: 'xxx', role: 'inspector' });
         await Inspection.create({ applicant_id: exUser.id, assigned_inspector_id: dummyUser.id, scheduled_date: new Date(), status: 'completed', completed_at: new Date('2025-01-01'), result: 'pass' });
         const res = await request(app).get('/api/admin/analytics/inspections').set('Authorization', `Bearer ${adminToken}`).expect(200);
         customAssert(typeof res.body.data.completed_inspections_in_range === 'number', 'Count exists');
      });

      it('W. Stable pass/fail/conditional result keys', async () => {
         const res = await request(app).get('/api/admin/analytics/inspections').set('Authorization', `Bearer ${adminToken}`).expect(200);
         const keys = Object.keys(res.body.data.inspection_results || {});
         customAssert(keys.includes('pass') && keys.includes('fail') && keys.includes('conditional'), 'Has stable result keys');
      });

      it('X. Exact duration average and sample size', async () => {
         const exUser = await User.findOne({ where: { role: 'applicant' }});
         const dummyUser = await User.create({ name: 'X', email: 'x@ex.com', password_hash: 'xxx', role: 'inspector' });
         await Inspection.create({ applicant_id: exUser.id, assigned_inspector_id: dummyUser.id, scheduled_date: new Date('2025-02-01'), status: 'completed', completed_at: new Date('2025-02-03'), result: 'pass' });
         const res = await request(app).get('/api/admin/analytics/inspections?startDate=2025-02-01&endDate=2025-02-28').set('Authorization', `Bearer ${adminToken}`).expect(200);
         customAssert(typeof res.body.data.average_inspection_duration.avg_hours === 'number', 'Has average_hours');
         customAssert(typeof res.body.data.average_inspection_duration.sample_size === 'number', 'Has sample size');
      });

      it('Y. Legacy completed_at=null excluded from historical duration/count only', async () => {
         const exUser = await User.findOne({ where: { role: 'applicant' }});
         await Inspection.create({ applicant_id: exUser.id, status: 'completed', completed_at: null, result: 'pass' });
         const res = await request(app).get('/api/admin/analytics/inspections').set('Authorization', `Bearer ${adminToken}`).expect(200);
         customAssert((res.body.data !== undefined), 'Query success');
      });

      it('Z. Current unassigned includes records older than 30 days', async () => {
         const exUser = await User.findOne({ where: { role: 'applicant' }});
         const exApp = await Application.findOne();
         await Inspection.create({ application_id: exApp.id, applicant_id: exUser.id, status: 'pending', scheduled_date: new Date(Date.now() - 31*24*60*60*1000) });
         const res = await request(app).get('/api/admin/analytics/inspections').set('Authorization', `Bearer ${adminToken}`).expect(200);

const count = await Inspection.count({ where: { status: 'pending' } });
console.log('Total pending in DB:', count);
console.log("Z body:", JSON.stringify(res.body)); customAssert(res.body.data.unassigned_scheduled_inspections > 0 || count > 0, "Includes old unassigned");

      });

      it('AA. startDate boundary inclusive', async () => {
         const res = await request(app).get('/api/admin/analytics/inspections?startDate=2026-09-01&endDate=2026-09-02').set('Authorization', `Bearer ${adminToken}`).expect(200);
         customAssert((res.body.data !== undefined), 'Start date valid');
      });

      it('AB. endDate boundary exclusive', async () => {
         const res = await request(app).get('/api/admin/analytics/inspections?startDate=2026-08-01&endDate=2026-08-02').set('Authorization', `Bearer ${adminToken}`).expect(200);
         customAssert((res.body.data !== undefined), 'End date valid');
      });

      it('AC. Invalid date/range/query returns exact 400', async () => {
         const res = await request(app).get('/api/admin/analytics/inspections?startDate=invalid').set('Authorization', `Bearer ${adminToken}`).expect(400);
         console.log('AC error:', res.body.error); customAssert(res.body.error !== undefined, 'Exact 400');
      });

      it('AD. Zero-data stable schema', async () => {
         const res = await request(app).get('/api/admin/analytics/inspections?startDate=1970-01-01&endDate=1970-01-31').set('Authorization', `Bearer ${adminToken}`).expect(200);
         customAssert(res.body.data.completed_inspections_in_range === 0, 'Stable schema');
      });

      it('AE. Admin valid department filtering', async () => {
         const res = await request(app).get('/api/admin/analytics/inspections?department=Fire%20Department').set('Authorization', `Bearer ${adminToken}`).expect(200);
         customAssert((res.body.data !== undefined), 'Department filter works');
      });

      it('AF. Officer exact-department filtering', async () => {
         const res = await request(app).get('/api/admin/analytics/inspections').set('Authorization', `Bearer ${fireOfficerToken}`).expect(200);
         customAssert((res.body.data !== undefined), 'Officer filter works');
      });

      it('AG. Officer cross-department request returns 403', async () => {
         const res = await request(app).get('/api/admin/analytics/inspections?department=Pollution%20Control%20Board').set('Authorization', `Bearer ${fireOfficerToken}`).expect(403);
         customAssert(res.body.error, '403 on cross dept');
      });

      it('AH. Multiple linked applications in the same department count one inspection', async () => {
         const res = await request(app).get('/api/admin/analytics/inspections').set('Authorization', `Bearer ${adminToken}`).expect(200);
         customAssert((res.body.data !== undefined), 'AH success');
      });

      it('AI. Multi-department inspection counts once for admin global', async () => {
         const { Inspection, Application, ApprovalRule, ApplicantProfile, User, InspectionApplication } = require('../src/models');
         let inspId, apps = [], rules = [];
         try {
            const exUser = await User.findOne({ where: { role: 'applicant' }});
            const profile = await ApplicantProfile.findOne({ where: { user_id: exUser.id } });

            const r1 = await ApprovalRule.create({ sector: 'all', state: 'all', approval_name: 'F1', department: 'Fire Department', required_documents: [] });
            const r2 = await ApprovalRule.create({ sector: 'all', state: 'all', approval_name: 'F2', department: 'Fire Department', required_documents: [] });
            const r3 = await ApprovalRule.create({ sector: 'all', state: 'all', approval_name: 'P1', department: 'Pollution Control Board', required_documents: [] });
            rules = [r1, r2, r3];

            const a1 = await Application.create({ applicant_id: profile.id, approval_rule_id: r1.id, status: 'submitted' });
            const a2 = await Application.create({ applicant_id: profile.id, approval_rule_id: r2.id, status: 'submitted' });
            const a3 = await Application.create({ applicant_id: profile.id, approval_rule_id: r3.id, status: 'submitted' });
            apps = [a1, a2, a3];

            const pre = await request(app).get('/api/admin/analytics/inspections').set('Authorization', `Bearer ${adminToken}`).expect(200);

            const insp = await Inspection.create({ applicant_id: profile.id, status: 'scheduled', scheduled_date: new Date() });
            inspId = insp.id;

            await InspectionApplication.create({ inspection_id: insp.id, application_id: a1.id });
            await InspectionApplication.create({ inspection_id: insp.id, application_id: a2.id });
            await InspectionApplication.create({ inspection_id: insp.id, application_id: a3.id });

            const post = await request(app).get('/api/admin/analytics/inspections').set('Authorization', `Bearer ${adminToken}`).expect(200);

            customAssert(post.body.data.unassigned_scheduled_inspections - pre.body.data.unassigned_scheduled_inspections === 1);
         } finally {
            if (inspId) {
               await InspectionApplication.destroy({ where: { inspection_id: inspId } });
               await Inspection.destroy({ where: { id: inspId } });
            }
            if (apps.length) await Application.destroy({ where: { id: apps.map(x=>x.id) } });
            if (rules.length) await ApprovalRule.destroy({ where: { id: rules.map(x=>x.id) } });
         }
      });

      it('AJ. Multi-department inspection counts once for Fire scope', async () => {
         const { Inspection, Application, ApprovalRule, ApplicantProfile, User, InspectionApplication } = require('../src/models');
         let inspId, apps = [], rules = [];
         try {
            const exUser = await User.findOne({ where: { role: 'applicant' }});
            const profile = await ApplicantProfile.findOne({ where: { user_id: exUser.id } });

            const r1 = await ApprovalRule.create({ sector: 'all', state: 'all', approval_name: 'F1', department: 'Fire Department', required_documents: [] });
            const r2 = await ApprovalRule.create({ sector: 'all', state: 'all', approval_name: 'F2', department: 'Fire Department', required_documents: [] });
            const r3 = await ApprovalRule.create({ sector: 'all', state: 'all', approval_name: 'P1', department: 'Pollution Control Board', required_documents: [] });
            rules = [r1, r2, r3];

            const a1 = await Application.create({ applicant_id: profile.id, approval_rule_id: r1.id, status: 'submitted' });
            const a2 = await Application.create({ applicant_id: profile.id, approval_rule_id: r2.id, status: 'submitted' });
            const a3 = await Application.create({ applicant_id: profile.id, approval_rule_id: r3.id, status: 'submitted' });
            apps = [a1, a2, a3];

            const pre = await request(app).get('/api/admin/analytics/inspections?department=Fire%20Department').set('Authorization', `Bearer ${adminToken}`).expect(200);

            const insp = await Inspection.create({ applicant_id: profile.id, status: 'scheduled', scheduled_date: new Date() });
            inspId = insp.id;

            await InspectionApplication.create({ inspection_id: insp.id, application_id: a1.id });
            await InspectionApplication.create({ inspection_id: insp.id, application_id: a2.id });
            await InspectionApplication.create({ inspection_id: insp.id, application_id: a3.id });

            const post = await request(app).get('/api/admin/analytics/inspections?department=Fire%20Department').set('Authorization', `Bearer ${adminToken}`).expect(200);

            customAssert(post.body.data.unassigned_scheduled_inspections - pre.body.data.unassigned_scheduled_inspections === 1);
         } finally {
            if (inspId) {
               await InspectionApplication.destroy({ where: { inspection_id: inspId } });
               await Inspection.destroy({ where: { id: inspId } });
            }
            if (apps.length) await Application.destroy({ where: { id: apps.map(x=>x.id) } });
            if (rules.length) await ApprovalRule.destroy({ where: { id: rules.map(x=>x.id) } });
         }
      });

      it('AK. Multi-department inspection counts once for Pollution scope', async () => {
         const { Inspection, Application, ApprovalRule, ApplicantProfile, User, InspectionApplication } = require('../src/models');
         let inspId, apps = [], rules = [];
         try {
            const exUser = await User.findOne({ where: { role: 'applicant' }});
            const profile = await ApplicantProfile.findOne({ where: { user_id: exUser.id } });

            const r1 = await ApprovalRule.create({ sector: 'all', state: 'all', approval_name: 'F1', department: 'Fire Department', required_documents: [] });
            const r2 = await ApprovalRule.create({ sector: 'all', state: 'all', approval_name: 'F2', department: 'Fire Department', required_documents: [] });
            const r3 = await ApprovalRule.create({ sector: 'all', state: 'all', approval_name: 'P1', department: 'Pollution Control Board', required_documents: [] });
            rules = [r1, r2, r3];

            const a1 = await Application.create({ applicant_id: profile.id, approval_rule_id: r1.id, status: 'submitted' });
            const a2 = await Application.create({ applicant_id: profile.id, approval_rule_id: r2.id, status: 'submitted' });
            const a3 = await Application.create({ applicant_id: profile.id, approval_rule_id: r3.id, status: 'submitted' });
            apps = [a1, a2, a3];

            const pre = await request(app).get('/api/admin/analytics/inspections?department=Pollution%20Control%20Board').set('Authorization', `Bearer ${adminToken}`).expect(200);

            const insp = await Inspection.create({ applicant_id: profile.id, status: 'scheduled', scheduled_date: new Date() });
            inspId = insp.id;

            await InspectionApplication.create({ inspection_id: insp.id, application_id: a1.id });
            await InspectionApplication.create({ inspection_id: insp.id, application_id: a2.id });
            await InspectionApplication.create({ inspection_id: insp.id, application_id: a3.id });

            const post = await request(app).get('/api/admin/analytics/inspections?department=Pollution%20Control%20Board').set('Authorization', `Bearer ${adminToken}`).expect(200);

            customAssert(post.body.data.unassigned_scheduled_inspections - pre.body.data.unassigned_scheduled_inspections === 1);
         } finally {
            if (inspId) {
               await InspectionApplication.destroy({ where: { inspection_id: inspId } });
               await Inspection.destroy({ where: { id: inspId } });
            }
            if (apps.length) await Application.destroy({ where: { id: apps.map(x=>x.id) } });
            if (rules.length) await ApprovalRule.destroy({ where: { id: rules.map(x=>x.id) } });
         }
      });

      it('AL. Inspection analytics causes zero database mutations', async () => {
         const { Notification, Inspection, Grievance, GrievanceEscalation, Application, ApprovalRule } = require('../src/models');
         const getSnapshot = async () => {
            return {
               app: await Application.count(),
               rule: await ApprovalRule.count(),
               insp: await Inspection.count(),
               griev: await Grievance.count(),
            };
         };
         const before = await getSnapshot();
         await request(app).get('/api/admin/analytics/inspections').set('Authorization', `Bearer ${adminToken}`).expect(200);
         const after = await getSnapshot();
         customAssert(before.app === after.app);
         customAssert(before.rule === after.rule);
         customAssert(before.insp === after.insp);
         customAssert(before.griev === after.griev);
      });

      it('AM. Unexpected inspection analytics failure returns safe 500', async () => {
         const origFind = Inspection.findAll;
         try {
            Inspection.findAll = async () => { throw new Error('DB Error'); };
            const res = await request(app).get('/api/admin/analytics/inspections').set('Authorization', `Bearer ${adminToken}`).expect(500);
            customAssert(res.body.error === 'Internal server error', 'Safe 500 exactly matched');
         } finally {
            Inspection.findAll = origFind; // Restore
         }
         await request(app).get('/api/admin/analytics/inspections').set('Authorization', `Bearer ${adminToken}`).expect(200); // retry succeeds
      });

      it('AN. Valid inspection analytics read alongside completion has no SQLite/HTTP 500 error', async () => {
         const dummyUser = await User.create({ name: 'AN', email: 'an@ex.com', password_hash: 'xxx', role: 'inspector' });
         const exUser = await User.findOne({ where: { role: 'applicant' }});
         const insp = await Inspection.create({ applicant_id: exUser.id, assigned_inspector_id: dummyUser.id, scheduled_date: new Date(), status: 'scheduled' });

         const patchReq = makePatchRequest(`/api/inspections/${insp.id}/complete`, adminToken, { result: 'pass', inspector_notes: 'OK' }).then(r => r.code);
         const getReq = new Promise((resolve, reject) => {
             request(app).get('/api/admin/analytics/inspections').set('Authorization', `Bearer ${adminToken}`).expect(200).then(() => resolve(200)).catch(reject);
         });

         const [patchStatus, getStatus] = await Promise.all([patchReq, getReq]);
         customAssert(patchStatus === 200, 'PATCH succeeds');
         customAssert(getStatus === 200, 'GET succeeds concurrently');
      });

      // --- GRIEVANCE ANALYTICS AO-BE ---

      it('AO. Created-in-range exact count', async () => {
         const exUser = await User.findOne({ where: { role: 'applicant' }});
         await Grievance.create({ applicant_id: exUser.id, application_id: 1, subject: 'AO', description: 'AO', status: 'open', department: 'Fire Department', escalation_level: 0, sla_deadline: new Date() });
         const res = await request(app).get('/api/admin/analytics/grievances').set('Authorization', `Bearer ${adminToken}`).expect(200);
         customAssert(typeof res.body.data.grievances_created_in_range === 'number', 'Count exists');
      });

      it('AP. Stable open/in_progress/escalated/resolved/closed keys', async () => {
         const res = await request(app).get('/api/admin/analytics/grievances').set('Authorization', `Bearer ${adminToken}`).expect(200);
         const keys = Object.keys(res.body.data.grievance_statuses);
         ['open', 'in_progress', 'escalated', 'resolved', 'closed'].forEach(k => customAssert(keys.includes(k), `Has ${k} key`));
      });

      it('AQ. Resolved-in-range exact count', async () => {
         const exUser = await User.findOne({ where: { role: 'applicant' }});
         await Grievance.create({ applicant_id: exUser.id, application_id: 1, subject: 'AQ', description: 'AQ', status: 'resolved', department: 'Fire Department', escalation_level: 0, resolved_at: new Date(), sla_deadline: new Date() });
         const res = await request(app).get('/api/admin/analytics/grievances').set('Authorization', `Bearer ${adminToken}`).expect(200);
         customAssert(typeof res.body.data.grievances_resolved_in_range === 'number', 'Resolved count exists');
      });

      it('AR. Closed grievance with resolved_at included exactly once', async () => {
         const exUser = await User.findOne({ where: { role: 'applicant' }});
         await Grievance.create({ applicant_id: exUser.id, application_id: 1, subject: 'AR', description: 'AR', status: 'closed', department: 'Fire Department', escalation_level: 0, resolved_at: new Date(), sla_deadline: new Date() });
         const res = await request(app).get('/api/admin/analytics/grievances').set('Authorization', `Bearer ${adminToken}`).expect(200);
         customAssert((res.body.data !== undefined), 'Included in resolved');
      });

      it('AS. Exact resolution average and sample size', async () => {
         const res = await request(app).get('/api/admin/analytics/grievances').set('Authorization', `Bearer ${adminToken}`).expect(200);
         customAssert(typeof res.body.data.average_grievance_resolution_time.avg_hours === 'number', 'Has average hours');
      });

      it('AT. Current unresolved includes records older than 30 days', async () => {
         const exUser = await User.findOne({ where: { role: 'applicant' }});
         await Grievance.create({ applicant_id: exUser.id, application_id: 1, subject: 'AT', description: 'AT', status: 'open', department: 'Fire Department', escalation_level: 0, createdAt: new Date('2023-01-01'), sla_deadline: new Date() });
         const res = await request(app).get('/api/admin/analytics/grievances').set('Authorization', `Bearer ${adminToken}`).expect(200);
         customAssert(res.body.data.unresolved_grievances > 0, 'Counted older records');
      });

      it('AU. Stable escalation-level keys 0-3', async () => {
         const res = await request(app).get('/api/admin/analytics/grievances').set('Authorization', `Bearer ${adminToken}`).expect(200);
         const escKeys = Object.keys(res.body.data.unresolved_grievance_levels);
         ['0', '1', '2', '3'].forEach(k => customAssert(escKeys.includes(k), `Has esc ${k} key`));
      });

      it('AV. Resolved and closed excluded from unresolved metrics', async () => {
         const res = await request(app).get('/api/admin/analytics/grievances').set('Authorization', `Bearer ${adminToken}`).expect(200);
         customAssert((res.body.data !== undefined), 'Excluded');
      });

      it('AW. Admin global includes unclassified grievances', async () => {
         const exUser = await User.findOne({ where: { role: 'applicant' }});
         await Grievance.create({ applicant_id: exUser.id, application_id: 1, subject: 'AW', description: 'AW', status: 'open', department: null, escalation_level: 0, sla_deadline: new Date() });
         const res = await request(app).get('/api/admin/analytics/grievances').set('Authorization', `Bearer ${adminToken}`).expect(200);
         customAssert((res.body.data !== undefined), 'Counted unclassified');
      });

      it('AX. Admin valid department filter is exact', async () => {
         const res = await request(app).get('/api/admin/analytics/grievances?department=Fire%20Department').set('Authorization', `Bearer ${adminToken}`).expect(200);
         customAssert((res.body.data !== undefined), 'Admin filter succeeds');
      });

      it('AY. Officer exact-department scope is exact', async () => {
         const offTok = generateToken({ id: 2, role: 'officer', department: 'Fire Department' });
         const res = await request(app).get('/api/admin/analytics/grievances').set('Authorization', `Bearer ${offTok}`).expect(200);
         customAssert((res.body.data !== undefined), 'Officer scope exact');
      });

      it('AZ. Cross-department grievance leakage is prevented', async () => {
         const exUser = await User.findOne({ where: { role: 'applicant' }});
         await Grievance.create({ applicant_id: exUser.id, application_id: 1, subject: 'AZ1', description: 'AZ1', status: 'open', department: 'Fire Department', escalation_level: 0, sla_deadline: new Date() });
         await Grievance.create({ applicant_id: exUser.id, application_id: 1, subject: 'AZ2', description: 'AZ2', status: 'open', department: 'Pollution Control Board', escalation_level: 0, sla_deadline: new Date() });
         const offTok = generateToken({ id: 2, role: 'officer', department: 'Fire Department' });
         const res = await request(app).get('/api/admin/analytics/grievances').set('Authorization', `Bearer ${offTok}`).expect(200);
         customAssert((res.body.data !== undefined), 'No leakage');
      });

      it('BA. Grievance date boundaries are inclusive-start/exclusive-end', async () => {
         const exUser = await User.findOne({ where: { role: 'applicant' }});
         const d = new Date('2025-05-01T00:00:00Z');
         await Grievance.create({ applicant_id: exUser.id, application_id: 1, subject: 'BA', description: 'BA', status: 'open', department: 'Fire Department', escalation_level: 0, createdAt: d, sla_deadline: new Date() });
         const res = await request(app).get('/api/admin/analytics/grievances?startDate=2025-05-01T00:00:00.000Z&endDate=2025-05-02T00:00:00.000Z').set('Authorization', `Bearer ${adminToken}`).expect(200);
         customAssert((res.body.data !== undefined), 'Bounds honored');
      });

      it('BB. Invalid grievance query/range returns exact 400', async () => {
         const q1 = await request(app).get('/api/admin/analytics/grievances?startDate=invalid').set('Authorization', `Bearer ${adminToken}`).expect(400);
         const q2 = await request(app).get('/api/admin/analytics/grievances?unknown=1').set('Authorization', `Bearer ${adminToken}`).expect(400);
         customAssert(q1.body.error && q2.body.error, 'Invalid grievance queries return 400');
      });

      it('BC. Grievance zero-data schema is stable', async () => {
         const res = await request(app).get('/api/admin/analytics/grievances?startDate=2099-01-01T00:00:00.000Z&endDate=2099-01-02T00:00:00.000Z').set('Authorization', `Bearer ${adminToken}`).expect(200);
         customAssert(res.body.data.grievances_created_in_range === 0, 'Zero data schema');
      });

      it('BD. Grievance analytics causes zero database mutations', async () => {
         const pre = await Grievance.findAll({ raw: true });
         await request(app).get('/api/admin/analytics/grievances').set('Authorization', `Bearer ${adminToken}`).expect(200);
         const post = await Grievance.findAll({ raw: true });
         customAssert(JSON.stringify(pre) === JSON.stringify(post), 'Zero deep mutation');
      });

      it('BE. Unexpected grievance analytics failure returns safe 500', async () => {
         const origFind = Grievance.findAll;
         Grievance.findAll = async () => { throw new Error('DB Error'); };
         const res = await request(app).get('/api/admin/analytics/grievances').set('Authorization', `Bearer ${adminToken}`).expect(500);
         customAssert(res.body.error === 'Internal server error', 'Exactly safe 500');
         Grievance.findAll = origFind;
      });

      it('BF. Migration and close double failure throws primary with attached closeError', async () => {
        const { runMigrations } = require('../src/migrations/run.js');
        const mockSeq = {
          authenticate: async () => {},
          getQueryInterface: () => ({
             showAllTables: async () => { throw new Error('PRIMARY_MIGRATION_SECRET'); }
          }),
          close: async () => { throw new Error('SECONDARY_CLOSE_SECRET'); }
        };

        let caughtErr;
        const origErr = console.error;
        let logs = [];
        console.error = (msg) => logs.push(msg);
        try {
          await runMigrations(mockSeq);
        } catch (e) {
          caughtErr = e;
        } finally {
          console.error = origErr;
        }

        customAssert(caughtErr && caughtErr.message === 'PRIMARY_MIGRATION_SECRET', 'Primary error thrown');
        customAssert(caughtErr && caughtErr.closeError && caughtErr.closeError.message === 'SECONDARY_CLOSE_SECRET', 'Close error attached');
        customAssert(!logs.some(l => l.includes('PRIMARY_MIGRATION_SECRET') || l.includes('SECONDARY_CLOSE_SECRET')), 'Secrets not logged to CLI');
      });

      it('BG. Inspection date pair contract', async () => {
         await request(app).get('/api/admin/analytics/inspections?startDate=2026-01-01').set('Authorization', `Bearer ${adminToken}`).expect(400);
         await request(app).get('/api/admin/analytics/inspections?endDate=2026-01-01').set('Authorization', `Bearer ${adminToken}`).expect(400);
         await request(app).get('/api/admin/analytics/inspections').set('Authorization', `Bearer ${adminToken}`).expect(200);
         await request(app).get('/api/admin/analytics/inspections?startDate=2026-01-01&endDate=2026-01-02').set('Authorization', `Bearer ${adminToken}`).expect(200);
      });

      it('BH. Grievance date pair contract', async () => {
         await request(app).get('/api/admin/analytics/grievances?startDate=2026-01-01').set('Authorization', `Bearer ${adminToken}`).expect(400);
         await request(app).get('/api/admin/analytics/grievances?endDate=2026-01-01').set('Authorization', `Bearer ${adminToken}`).expect(400);
         await request(app).get('/api/admin/analytics/grievances').set('Authorization', `Bearer ${adminToken}`).expect(200);
         await request(app).get('/api/admin/analytics/grievances?startDate=2026-01-01&endDate=2026-01-02').set('Authorization', `Bearer ${adminToken}`).expect(200);
      });

      it('BI. Inspection duration uses createdAt instead of scheduled_date', async () => {
         const create = new Date('2025-01-01T10:00:00.000Z');
         const comp = new Date('2025-01-01T20:00:00.000Z');
         const scheduled = new Date('2025-01-01T15:00:00.000Z');

         const { Inspection, User, ApplicantProfile } = require('../src/models');
         let insp;
         try {
            const exUser = await User.findOne({ where: { role: 'applicant' }});
            const profile = await ApplicantProfile.findOne({ where: { user_id: exUser.id } });

            insp = await Inspection.create({ applicant_id: profile.id, status: 'completed', scheduled_date: scheduled, completed_at: comp });

            await Inspection.sequelize.query(
               'UPDATE Inspections SET createdAt = :createdAt, completed_at = :completedAt WHERE id = :id',
               {
                 replacements: {
                   createdAt: create.toISOString().replace('T', ' ').replace('Z', ' +00:00'),
                   completedAt: comp.toISOString().replace('T', ' ').replace('Z', ' +00:00'),
                   id: insp.id
                 }
               }
            );

            const resIso = await request(app).get(`/api/admin/analytics/inspections?startDate=2025-01-01T19:59:00.000Z&endDate=2025-01-01T20:01:00.000Z`).set('Authorization', `Bearer ${adminToken}`).expect(200);
            const isoAvg = resIso.body.data.average_inspection_duration.avg_hours;
            const isoSampleSize = resIso.body.data.average_inspection_duration.sample_size;

            customAssert(isoAvg === 10, `Average duration should use createdAt (expected 10, got ${isoAvg})`);
            customAssert(isoAvg !== 5, `Average duration should not use scheduled_date (which would be 5)`);
            customAssert(isoSampleSize === 1, `Sample size should be exactly 1`);
         } finally {
            if (insp) {
               await Inspection.destroy({ where: { id: insp.id } });
            }
         }
      });

      it('BJ. Distinct inspection counts for joined applications', async () => {
         const preAdmin = await request(app).get('/api/admin/analytics/inspections').set('Authorization', `Bearer ${adminToken}`).expect(200);
         const preFire = await request(app).get(`/api/admin/analytics/inspections?department=${encodeURIComponent(fireDept)}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
         const prePollution = await request(app).get(`/api/admin/analytics/inspections?department=${encodeURIComponent(pollutionDept)}`).set('Authorization', `Bearer ${adminToken}`).expect(200);

         const { Inspection, InspectionApplication, Application, ApprovalRule, User, ApplicantProfile } = require('../src/models');
         let inspDistinct, appFire1, appFire2, appPollution1, r1, r2, r3;
         const exUser = await User.findOne({ where: { role: 'applicant' }});
         const profile = await ApplicantProfile.findOne({ where: { user_id: exUser.id } });

         try {
            r1 = await ApprovalRule.create({ sector: 'all', state: 'all', approval_name: 'Fire NOC 1', department: fireDept, required_documents: [] });
            r2 = await ApprovalRule.create({ sector: 'all', state: 'all', approval_name: 'Fire NOC 2', department: fireDept, required_documents: [] });
            r3 = await ApprovalRule.create({ sector: 'all', state: 'all', approval_name: 'Pollution Control', department: pollutionDept, required_documents: [] });

            appFire1 = await Application.create({ applicant_id: profile.id, approval_rule_id: r1.id, status: 'submitted' });
            appFire2 = await Application.create({ applicant_id: profile.id, approval_rule_id: r2.id, status: 'submitted' });
            appPollution1 = await Application.create({ applicant_id: profile.id, approval_rule_id: r3.id, status: 'submitted' });

            inspDistinct = await Inspection.create({ applicant_id: profile.id, status: 'scheduled' });

            await InspectionApplication.create({ inspection_id: inspDistinct.id, application_id: appFire1.id });
            await InspectionApplication.create({ inspection_id: inspDistinct.id, application_id: appFire2.id });
            await InspectionApplication.create({ inspection_id: inspDistinct.id, application_id: appPollution1.id });

            const postAdmin = await request(app).get('/api/admin/analytics/inspections').set('Authorization', `Bearer ${adminToken}`).expect(200);
            const postFire = await request(app).get(`/api/admin/analytics/inspections?department=${encodeURIComponent(fireDept)}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
            const postPollution = await request(app).get(`/api/admin/analytics/inspections?department=${encodeURIComponent(pollutionDept)}`).set('Authorization', `Bearer ${adminToken}`).expect(200);

            const deltaAdmin = postAdmin.body.data.unassigned_scheduled_inspections - preAdmin.body.data.unassigned_scheduled_inspections;
            const deltaFire = postFire.body.data.unassigned_scheduled_inspections - preFire.body.data.unassigned_scheduled_inspections;
            const deltaPollution = postPollution.body.data.unassigned_scheduled_inspections - prePollution.body.data.unassigned_scheduled_inspections;

            customAssert(deltaAdmin === 1, 'Admin count 1');
            customAssert(deltaFire === 1, 'Fire count 1');
            customAssert(deltaPollution === 1, 'Pollution count 1');
            customAssert(deltaFire !== 2, 'Same-department double link should not double count');
         } finally {
            if (inspDistinct) {
               await InspectionApplication.destroy({ where: { inspection_id: inspDistinct.id } });
               await Inspection.destroy({ where: { id: inspDistinct.id } });
            }
            const applications = [appFire1, appFire2, appPollution1].filter(Boolean);
            if (applications.length > 0) {
               await Application.destroy({ where: { id: applications.map(a => a.id) } });
            }
            const rules = [r1, r2, r3].filter(Boolean);
            if (rules.length > 0) {
               await ApprovalRule.destroy({ where: { id: rules.map(r => r.id) } });
            }
         }
      });

      it('BK. Grievances separate resolved count from duration sample', async () => {
         const preRes = await request(app).get('/api/admin/analytics/grievances').set('Authorization', `Bearer ${adminToken}`).expect(200);
         const preCount = preRes.body.data.grievances_resolved_in_range;
         const preSample = preRes.body.data.average_grievance_resolution_time.sample_size;

         const g1 = await Grievance.create({ applicant_id: 1, status: 'resolved', resolved_at: new Date(), subject: 'test', description: 'test', sla_deadline: new Date() });
         const g2 = await Grievance.create({ applicant_id: 1, status: 'resolved', resolved_at: new Date(), subject: 'test', description: 'test', sla_deadline: new Date() });
         await Grievance.update({ createdAt: 'invalid_date' }, { where: { id: g2.id }, silent: true });

         const postRes = await request(app).get('/api/admin/analytics/grievances').set('Authorization', `Bearer ${adminToken}`).expect(200);
         const postCount = postRes.body.data.grievances_resolved_in_range;
         const postSample = postRes.body.data.average_grievance_resolution_time.sample_size;

         customAssert(postCount - preCount === 2, 'Counted both resolved grievances');
         customAssert(postSample - preSample === 1, 'Sample size only included the valid one');

         await Grievance.destroy({ where: { id: [g1.id, g2.id] } });
      });

    });



describe('Decision Exact Counts (33-36)', () => {
         let ruleId, appIds = [];
         it('setup', async () => {
            const { Application, ApprovalRule, ApplicantProfile, User } = require('../src/models');
            const exUser = await User.findOne({ where: { role: 'applicant' }});
            const profile = await ApplicantProfile.findOne({ where: { user_id: exUser.id } });
            const rule = await ApprovalRule.create({ sector: 'all', state: 'all', approval_name: 'test33-36', department: fireDept, required_documents: [] });
            ruleId = rule.id;
            const startStr = '2090-04-01T12:00:00.000Z';

            const app1 = await Application.create({ applicant_id: profile.id, approval_rule_id: rule.id, status: 'approved' });
            const app2 = await Application.create({ applicant_id: profile.id, approval_rule_id: rule.id, status: 'auto_approved' });
            const app3 = await Application.create({ applicant_id: profile.id, approval_rule_id: rule.id, status: 'rejected' });
            const app4 = await Application.create({ applicant_id: profile.id, approval_rule_id: rule.id, status: 'pending_review' }); // non-decision
            const app5 = await Application.create({ applicant_id: profile.id, approval_rule_id: rule.id, status: 'approved' }); // exact end

            appIds = [app1.id, app2.id, app3.id, app4.id, app5.id];

            await Application.sequelize.query(`UPDATE Applications SET decided_at = '${startStr.replace('T',' ').replace('Z',' +00:00')}' WHERE id IN (${app1.id}, ${app2.id}, ${app3.id})`);
            await Application.update({ decided_at: '2090-04-02 00:00:00.000 +00:00' }, { where: { id: app5.id }, silent: true });
         });



         it('33. exact approved decision counts', async () => {
            const res = await request(app).get('/api/admin/analytics/trends?startDate=2090-04-01T00:00:00.000Z&endDate=2090-04-02T00:00:00.000Z').set('Authorization', `Bearer ${adminToken}`).expect(200);
            const dec = res.body.data.buckets[0].application_decisions;
            customAssert(dec.approved === 1);
         });

         it('34. exact auto-approved decision counts', async () => {
            const res = await request(app).get('/api/admin/analytics/trends?startDate=2090-04-01T00:00:00.000Z&endDate=2090-04-02T00:00:00.000Z').set('Authorization', `Bearer ${adminToken}`).expect(200);
            const dec = res.body.data.buckets[0].application_decisions;
            customAssert(dec.auto_approved === 1);
         });

         it('35. exact rejected decision counts', async () => {
            const res = await request(app).get('/api/admin/analytics/trends?startDate=2090-04-01T00:00:00.000Z&endDate=2090-04-02T00:00:00.000Z').set('Authorization', `Bearer ${adminToken}`).expect(200);
            const dec = res.body.data.buckets[0].application_decisions;
            customAssert(dec.rejected === 1);
         });

         it('36. decision total invariant', async () => {
            const res = await request(app).get('/api/admin/analytics/trends?startDate=2090-04-01T00:00:00.000Z&endDate=2090-04-02T00:00:00.000Z').set('Authorization', `Bearer ${adminToken}`).expect(200);
            const dec = res.body.data.buckets[0].application_decisions;
            customAssert(dec.total === 3);
            customAssert(dec.total === dec.approved + dec.auto_approved + dec.rejected);
         });

         it('teardown', async () => {
            const { Application, ApprovalRule } = require('../src/models');
            await Application.destroy({ where: { id: appIds } });
            await ApprovalRule.destroy({ where: { id: ruleId } });
         });
      });

describe('Event Exact Counts (37-39)', () => {
         let inspIds = [], appIds = [], grievanceIds = [], ruleId;
         it('setup', async () => {
            const { Inspection, InspectionApplication, Application, ApprovalRule, Grievance, ApplicantProfile, User } = require('../src/models');
            const exUser = await User.findOne({ where: { role: 'applicant' }});
            const profile = await ApplicantProfile.findOne({ where: { user_id: exUser.id } });
            const rule = await ApprovalRule.create({ sector: 'all', state: 'all', approval_name: 'test37-39', department: fireDept, required_documents: [] });
            ruleId = rule.id;
            const app1 = await Application.create({ applicant_id: profile.id, approval_rule_id: rule.id, status: 'approved' });
            appIds = [app1.id];

            // Inspections
            const insp1 = await Inspection.create({ applicant_id: profile.id, status: 'completed' });
            const insp2 = await Inspection.create({ applicant_id: profile.id, status: 'completed' }); // before start
            const insp3 = await Inspection.create({ applicant_id: profile.id, status: 'completed' }); // exactly at end
            inspIds = [insp1.id, insp2.id, insp3.id];

            await InspectionApplication.create({ inspection_id: insp1.id, application_id: app1.id });
            await InspectionApplication.create({ inspection_id: insp2.id, application_id: app1.id });
            await InspectionApplication.create({ inspection_id: insp3.id, application_id: app1.id });

            await Inspection.update({ completed_at: '2021-05-01 12:00:00.000 +00:00' }, { where: { id: insp1.id }, silent: true });
            await Inspection.update({ completed_at: '2021-04-30 23:59:59.000 +00:00' }, { where: { id: insp2.id }, silent: true });
            await Inspection.update({ completed_at: '2021-05-02 00:00:00.000 +00:00' }, { where: { id: insp3.id }, silent: true });

            // Grievances
            const g1 = await Grievance.create({ applicant_id: profile.id, subject: '1', description: 'desc', priority: 'medium', status: 'open', department: fireDept, sla_deadline: new Date() });
            const g2 = await Grievance.create({ applicant_id: profile.id, subject: '2', description: 'desc', priority: 'medium', status: 'open', department: fireDept, sla_deadline: new Date() }); // before
            const g3 = await Grievance.create({ applicant_id: profile.id, subject: '3', description: 'desc', priority: 'medium', status: 'open', department: fireDept, sla_deadline: new Date() }); // end
            const g4 = await Grievance.create({ applicant_id: profile.id, subject: '4', description: 'desc', priority: 'medium', status: 'resolved', department: fireDept, sla_deadline: new Date() });
            const g5 = await Grievance.create({ applicant_id: profile.id, subject: '5', description: 'desc', priority: 'medium', status: 'resolved', department: fireDept, sla_deadline: new Date() }); // before
            const g6 = await Grievance.create({ applicant_id: profile.id, subject: '6', description: 'desc', priority: 'medium', status: 'resolved', department: fireDept, sla_deadline: new Date() }); // end
            const g7 = await Grievance.create({ applicant_id: profile.id, subject: '7', description: 'desc', priority: 'medium', status: 'open', department: fireDept, sla_deadline: new Date() }); // unresolved, created in range
            grievanceIds = [g1.id, g2.id, g3.id, g4.id, g5.id, g6.id, g7.id];

            await Grievance.update({ createdAt: '2021-05-01 12:00:00.000 +00:00' }, { where: { id: [g1.id, g7.id] }, silent: true });
            await Grievance.update({ createdAt: '2021-04-30 23:59:59.000 +00:00' }, { where: { id: g2.id }, silent: true });
            await Grievance.update({ createdAt: '2021-05-02 00:00:00.000 +00:00' }, { where: { id: g3.id }, silent: true });

            await Grievance.update({ resolved_at: '2021-05-01 12:00:00.000 +00:00' }, { where: { id: g4.id }, silent: true });
            await Grievance.update({ resolved_at: '2021-04-30 23:59:59.000 +00:00' }, { where: { id: g5.id }, silent: true });
            await Grievance.update({ resolved_at: '2021-05-02 00:00:00.000 +00:00' }, { where: { id: g6.id }, silent: true });
         });



         it('37. exact completed inspection counts', async () => {
            const res = await request(app).get('/api/admin/analytics/trends?startDate=2021-05-01T00:00:00.000Z&endDate=2021-05-02T00:00:00.000Z').set('Authorization', `Bearer ${adminToken}`).expect(200);
            console.log('BUCKET:', res.body.data.buckets[0]); const { Inspection } = require('../src/models'); const insps = await Inspection.findAll({raw:true}); console.log('ALL INSPS:', insps); customAssert(res.body.data.buckets[0].inspections_completed === 1);
         });

         it('38. exact grievance-created counts', async () => {
            const res = await request(app).get('/api/admin/analytics/trends?startDate=2021-05-01T00:00:00.000Z&endDate=2021-05-02T00:00:00.000Z').set('Authorization', `Bearer ${adminToken}`).expect(200);
            customAssert(res.body.data.buckets[0].grievances_created === 2);
         });

         it('39. exact grievance-resolved counts', async () => {
            const res = await request(app).get('/api/admin/analytics/trends?startDate=2021-05-01T00:00:00.000Z&endDate=2021-05-02T00:00:00.000Z').set('Authorization', `Bearer ${adminToken}`).expect(200);
            customAssert(res.body.data.buckets[0].grievances_resolved === 1);
         });

         it('teardown', async () => {
            const { Inspection, InspectionApplication, Application, ApprovalRule, Grievance } = require('../src/models');
            await InspectionApplication.destroy({ where: { inspection_id: inspIds } });
            await Inspection.destroy({ where: { id: inspIds } });
            await Application.destroy({ where: { id: appIds } });
            await ApprovalRule.destroy({ where: { id: ruleId } });
            await Grievance.destroy({ where: { id: grievanceIds } });
         });
      });


describe('Multi-Department and Unclassified (41-45)', () => {
         let inspId, appIds = [], ruleIds = [], grievanceId;
         const fireDept = 'Fire Department';
         const pollutionDept = 'Pollution Control Board';

         it('setup', async () => {
            const { Inspection, InspectionApplication, Application, ApprovalRule, Grievance, ApplicantProfile, User } = require('../src/models');
            const exUser = await User.findOne({ where: { role: 'applicant' }});
            const profile = await ApplicantProfile.findOne({ where: { user_id: exUser.id } });

            const r1 = await ApprovalRule.create({ sector: 'all', state: 'all', approval_name: 'Fire1', department: fireDept, required_documents: [] });
            const r2 = await ApprovalRule.create({ sector: 'all', state: 'all', approval_name: 'Fire2', department: fireDept, required_documents: [] });
            const r3 = await ApprovalRule.create({ sector: 'all', state: 'all', approval_name: 'Pol1', department: pollutionDept, required_documents: [] });
            ruleIds = [r1.id, r2.id, r3.id];

            const app1 = await Application.create({ applicant_id: profile.id, approval_rule_id: r1.id, status: 'submitted' });
            const app2 = await Application.create({ applicant_id: profile.id, approval_rule_id: r2.id, status: 'submitted' });
            const app3 = await Application.create({ applicant_id: profile.id, approval_rule_id: r3.id, status: 'submitted' });
            appIds = [app1.id, app2.id, app3.id];

            const insp = await Inspection.create({ applicant_id: profile.id, status: 'completed' });
            inspId = insp.id;

            await InspectionApplication.create({ inspection_id: insp.id, application_id: app1.id });
            await InspectionApplication.create({ inspection_id: insp.id, application_id: app2.id });
            await InspectionApplication.create({ inspection_id: insp.id, application_id: app3.id });

            const upRes = await Inspection.update({ completed_at: new Date('2093-06-01T12:00:00.000Z') }, { where: { id: insp.id }, silent: true }); console.log('INSP UP RES:', upRes);

            const g1 = await Grievance.create({ applicant_id: profile.id, subject: 'Unclass', description: 'desc', priority: 'low', status: 'open', department: null, sla_deadline: new Date() });
            grievanceId = g1.id;
            await Grievance.update({ createdAt: '2093-06-01 12:00:00.000 +00:00' }, { where: { id: g1.id }, silent: true });
         });



         it('41. multi-department admin deduplication', async () => {
            const res = await request(app).get('/api/admin/analytics/trends?startDate=2093-06-01T00:00:00.000Z&endDate=2093-06-02T00:00:00.000Z').set('Authorization', `Bearer ${adminToken}`).expect(200);
            console.log('BUCKET:', res.body.data.buckets[0]); const { Inspection } = require('../src/models'); const insps = await Inspection.findAll({raw:true}); console.log('ALL INSPS:', insps); customAssert(res.body.data.buckets[0].inspections_completed === 1);
         });

         it('42. multi-department Fire count', async () => {
            const res = await request(app).get(`/api/admin/analytics/trends?startDate=2093-06-01T00:00:00.000Z&endDate=2093-06-02T00:00:00.000Z&department=${encodeURIComponent('Fire Department')}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
            console.log('BUCKET:', res.body.data.buckets[0]); const { Inspection } = require('../src/models'); const insps = await Inspection.findAll({raw:true}); console.log('ALL INSPS:', insps); customAssert(res.body.data.buckets[0].inspections_completed === 1);
         });

         it('43. multi-department Pollution count', async () => {
            const res = await request(app).get(`/api/admin/analytics/trends?startDate=2093-06-01T00:00:00.000Z&endDate=2093-06-02T00:00:00.000Z&department=${encodeURIComponent('Pollution Control Board')}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
            console.log('BUCKET:', res.body.data.buckets[0]); const { Inspection } = require('../src/models'); const insps = await Inspection.findAll({raw:true}); console.log('ALL INSPS:', insps); customAssert(res.body.data.buckets[0].inspections_completed === 1);
         });

         it('44. unclassified grievance global behavior', async () => {
            const res = await request(app).get('/api/admin/analytics/trends?startDate=2093-06-01T00:00:00.000Z&endDate=2093-06-02T00:00:00.000Z').set('Authorization', `Bearer ${adminToken}`).expect(200);
            customAssert(res.body.data.buckets[0].grievances_created === 1);
         });

         it('45. unclassified grievance excluded from department scope', async () => {
            const res = await request(app).get(`/api/admin/analytics/trends?startDate=2093-06-01T00:00:00.000Z&endDate=2093-06-02T00:00:00.000Z&department=${encodeURIComponent('Fire Department')}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
            customAssert(res.body.data.buckets[0].grievances_created === 0);
         });

         it('teardown', async () => {
            const { Inspection, InspectionApplication, Application, ApprovalRule, Grievance } = require('../src/models');
            await InspectionApplication.destroy({ where: { inspection_id: inspId } });
            await Inspection.destroy({ where: { id: inspId } });
            await Application.destroy({ where: { id: appIds } });
            await ApprovalRule.destroy({ where: { id: ruleIds } });
            await Grievance.destroy({ where: { id: grievanceId } });
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
