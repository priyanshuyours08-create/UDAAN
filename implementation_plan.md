# UDAAN Backend — Full Implementation Plan (v3 — final)

## Current State

The existing backend covers **6 of 10 PRD modules**:

| PRD Module | Status | Existing Files |
|---|---|---|
| 5.1 Regulatory Knowledge Engine (Dynamic Checklist) | ✅ Implemented | `checklistController.js`, `ApprovalRule.js` |
| 5.2 Applicant Journey & Data Reuse Vault | ✅ Implemented | `vaultController.js`, `DocumentVault.js` |
| 5.3 Pre-Validation & Auto-Scrutiny | ⚠️ Partial (auto-verified on upload, no real validation) | `vaultController.js` L20 |
| 5.4 Risk-Based Scrutiny & Routing | ✅ Implemented | `riskEngine.js`, `applicationController.js` |
| 5.5 Parallel Workflow Orchestration | ⚠️ Partial (parallel creation, no dependency mapping) | `applicationController.js` |
| 5.6 Common Inspection Planner | ❌ Missing | — |
| 5.7 SLA Tracking, Alerts & Escalation | ⚠️ Partial (countdown exists, no alerts/escalation) | `applicationController.js`, `adminController.js` |
| 5.8 Grievance Redressal | ❌ Missing | — |
| 5.9 Incentive & Scheme Matching | ✅ Implemented | `schemeController.js`, `Scheme.js` |
| 5.10 Unified Analytics Dashboard | ⚠️ Partial (basic stats, no trends/predictive) | `adminController.js` |

---

## Decisions Already Made

- **Inspector** is a separate role from officer.
- **Notifications** are in-database + polling only for this MVP; no SMS/email.
- **SQLite** for dev, Postgres-ready via `.env` switch.
- After any model ENUM change, re-run `npm run seed` for a clean DB.
- Work is done in priority order; each section is curl-verified before the next.

---

## Key Fixes in This Plan (v3 vs v2)

| # | Bug in v2 | Fix in v3 |
|---|---|---|
| FIX-1 | **Hardcoded ALLOWED_DOCUMENT_TYPES** blocked uploads for doc types added by new approval rules at runtime (Priority 6) | **Dynamic**: no document_type allowlist — validate non-empty string only. The rule engine decides what's required, not the vault. |
| FIX-2 | **Fail-open department scoping**: `if (req.user.department && ...)` silently waves through officers with null department | **Fail-closed**: strict `rule.department !== req.user.department` with no null guard. Officers with no department → 403. Only admins bypass. |
| FIX-3 | **Plain idempotency on inspection bundling**: returning existing inspection as-is ignores new pending_inspection apps submitted after the first bundle | **Additive merge**: finds existing scheduled inspection AND links any newly-pending applications not already joined. |
| FIX-4 | **SLA notifications only query officers**: pending_inspection apps handled by inspectors get zero notifications if no officer is staffed for that dept | **Query both**: `role: { [Op.in]: ['officer', 'inspector'] }` for warning and breach notifications. |
| FIX-5 | **No automatic grievance escalation**: manual-only escalateGrievance doesn't deliver PRD's "time-bound escalation" promise | **Cron-driven**: `checkGrievanceEscalations()` runs alongside SLA check, auto-escalates overdue grievances. |
| FIX-6 | **Delete guard only checks non-terminal applications**: deleting a rule after its apps reach 'approved' orphans FK references, crashes analytics | **Block ALL references**: `Application.count({ where: { approval_rule_id } })` with no status filter. Optionally soft-delete via `is_active` field. |

---

## Priority 1: Fix Correctness Gaps in Existing Code

### 1a. Document-Completeness Validation Before Submission

#### [MODIFY] `src/controllers/applicationController.js`

In `submitApplication`, after fetching matching `ApprovalRule` rows and BEFORE creating any `Application` rows, cross-check the applicant's `DocumentVault` entries against each rule's `required_documents` array.

```js
// Move vaultDocs fetch BEFORE the creation loop (currently at line 33)
const vaultDocs = await DocumentVault.findAll({ where: { applicant_id } });
const vaultDocTypes = vaultDocs.map(d => d.document_type);

// NEW: Completeness check — reject the entire submission if any docs are missing
// Why: the existing code silently creates applications even with an empty vault,
// which defeats the PRD's "reduces incomplete-application rejections at source" goal
const missingByApproval = [];
for (const rule of rules) {
  const missing = rule.required_documents.filter(
    docType => !vaultDocTypes.includes(docType)
  );
  if (missing.length > 0) {
    missingByApproval.push({
      approval_name: rule.approval_name,
      department: rule.department,
      missing_documents: missing,
    });
  }
}
if (missingByApproval.length > 0) {
  return res.status(400).json({
    error: 'Missing required documents',
    missing_by_approval: missingByApproval,
  });
}
```

---

### 1b. Submission Idempotency

#### [MODIFY] `src/controllers/applicationController.js`

Inside the `for (const rule of rules)` loop, before creating a new `Application`:

```js
// NEW: Idempotency check — skip if an active application already exists
// Why: prevents duplicate rows if the user (or frontend) calls submit twice
const existing = await Application.findOne({
  where: {
    applicant_id,
    approval_rule_id: rule.id,
    status: { [Op.notIn]: ['approved', 'auto_approved', 'rejected'] },
  },
});

if (existing) {
  createdApplications.push({
    application_id: existing.id,
    approval_name: rule.approval_name,
    department: rule.department,
    risk_level: existing.risk_level,
    status: existing.status,
    sla_deadline: existing.sla_deadline,
    already_existed: true,
  });
  continue;
}

// ...existing risk scoring + Application.create logic, adding already_existed: false...
```

---

### 1c. Document Pre-Validation on Upload — DYNAMIC (FIX-1)

#### [MODIFY] `src/models/DocumentVault.js`

Add: `expiry_date: { type: DataTypes.DATE, allowNull: true }`

#### [MODIFY] `src/controllers/vaultController.js`

**CRITICAL (FIX-1):** Do NOT hardcode an ALLOWED_DOCUMENT_TYPES list. Priority 6 lets admins create new approval rules with arbitrary `required_documents` values at runtime (e.g. a new "pharma" sector needing "Manufacturing License", "GMP Certificate"). A hardcoded allowlist would permanently block uploads for those types.

Instead, validate only structural properties:

```js
async function uploadDocument(req, res) {
  try {
    const { applicant_id, document_type, file_url, expiry_date } = req.body;
    if (!applicant_id || !document_type || !file_url) {
      return res.status(400).json({ error: 'applicant_id, document_type and file_url are required' });
    }

    // Validate document_type is a non-empty string (but do NOT check against a
    // fixed allowlist — the rule engine is the source of truth for what's required,
    // not the vault. Admins can create rules with arbitrary required_documents
    // via Priority 6's API, and we must accept uploads for those types.)
    if (typeof document_type !== 'string' || document_type.trim().length === 0) {
      return res.status(400).json({ error: 'document_type must be a non-empty string' });
    }

    // Validate file_url is a well-formed URL
    try { new URL(file_url); } catch {
      return res.status(400).json({ error: 'file_url is not a valid URL' });
    }

    // If expiry_date is provided and in the past, reject
    if (expiry_date && new Date(expiry_date) < new Date()) {
      return res.status(400).json({ error: 'Document has expired (expiry_date is in the past)' });
    }

    const profile = await ApplicantProfile.findByPk(applicant_id);
    if (!profile) return res.status(404).json({ error: 'Applicant profile not found' });

    const doc = await DocumentVault.create({
      applicant_id,
      document_type: document_type.trim(),
      file_url,
      expiry_date: expiry_date || null,
      // Mocked auto-verification for demo purposes — in production this would
      // integrate with DigiLocker/OCR for real document validation (stretch goal)
      verified_status: 'verified',
    });

    res.status(201).json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
```

---

### Priority 1 Verification

```bash
npm run seed && npm start
# 1a: submit with empty vault -> expect 400 with missing_by_approval detail
# 1b: upload all docs, submit, then submit again -> second call shows already_existed: true
# 1c: upload with invalid URL -> 400; upload with past expiry_date -> 400
# 1c: upload "Manufacturing License" (NOT in seed data) -> should SUCCEED (proves FIX-1)
```

---

## Priority 2: Add Inspector Role and Department Scoping (Fail-Closed)

### 2a. Add `inspector` Role and `department` Field

#### [MODIFY] `src/models/User.js`

```js
role: {
  type: DataTypes.ENUM('applicant', 'officer', 'inspector', 'admin'),
  defaultValue: 'applicant',
},
department: { type: DataTypes.STRING, allowNull: true },
```

#### [MODIFY] `src/controllers/authController.js`

- Accept `department` from `req.body` in register.
- Pass to `User.create()`.
- Update role validation: `['applicant', 'officer', 'inspector', 'admin']`.
- Include `department` in JWT payload: `jwt.sign({ id, role, department }, ...)`.
- Include `department` in response `user` object (both register and login).

---

### 2b. Department Scoping — FAIL-CLOSED (FIX-2)

#### [MODIFY] `src/controllers/applicationController.js` — `decideApplication`

```js
// NEW: Department scoping — FAIL-CLOSED (FIX-2)
// CRITICAL: this is a strict equality check with NO `req.user.department &&` guard.
// An officer with a null/missing department MUST be denied, not waved through.
// Only admins bypass this check entirely.
// Why fail-closed: if an officer is registered without a department (data entry error),
// they should see 403 until an admin fixes their profile — not silently gain access
// to every department's applications.
if (req.user.role !== 'admin') {
  const rule = await ApprovalRule.findByPk(application.approval_rule_id);
  if (rule.department !== req.user.department) {
    return res.status(403).json({
      error: 'You can only decide applications for your own department',
    });
  }
}
```

---

### Priority 2 Verification

```bash
npm run seed && npm start
# Register officer WITH department: 'Fire Department'
# Register officer WITHOUT department (or department: null)
# Officer with Fire Dept deciding Fire NOC app → success
# Officer with Fire Dept deciding Pollution NOC app → 403
# Officer with NO department deciding ANY app → 403 (proves FIX-2 fail-closed)
```

---

## Priority 3: Common Inspection Planner (PRD §5.6)

### New Models

#### [NEW] `src/models/Inspection.js`

| Field | Type | Notes |
|---|---|---|
| `id` | INTEGER, PK, autoIncrement | |
| `applicant_id` | INTEGER, not null | FK to ApplicantProfile |
| `scheduled_date` | DATE, not null | Default: now + 7 days |
| `status` | ENUM('scheduled','completed','cancelled') | Default: 'scheduled' |
| `inspector_notes` | TEXT, nullable | Filled on completion |
| `result` | ENUM('pass','fail','conditional'), nullable | Filled on completion |
| `assigned_inspector_id` | INTEGER, nullable | FK to User (inspector role) |

#### [NEW] `src/models/InspectionApplication.js`

| Field | Type | Notes |
|---|---|---|
| `id` | INTEGER, PK, autoIncrement | |
| `inspection_id` | INTEGER, not null | FK to Inspection |
| `application_id` | INTEGER, not null | FK to Application |

Unique constraint on `(inspection_id, application_id)` to prevent duplicate join rows.

### Associations

```js
Inspection.belongsToMany(Application, { through: InspectionApplication, foreignKey: 'inspection_id' });
Application.belongsToMany(Inspection, { through: InspectionApplication, foreignKey: 'application_id' });
Inspection.belongsTo(ApplicantProfile, { foreignKey: 'applicant_id' });
ApplicantProfile.hasMany(Inspection, { foreignKey: 'applicant_id' });
Inspection.belongsTo(User, { as: 'Inspector', foreignKey: 'assigned_inspector_id' });
```

### Controller — Additive Merge (FIX-3)

#### [NEW] `src/controllers/inspectionController.js`

**`bundleInspections(req, res)`**
```
Input: { applicant_id, assigned_inspector_id? }

1. Validate applicant profile exists.
2. Find all Applications where:
   - applicant_id matches
   - status = 'pending_inspection'
   Include ApprovalRule, filter to requires_inspection = true
3. If none found → 400: "No applications pending inspection"
4. Look for an existing Inspection where applicant_id matches, status='scheduled'
5. IF EXISTS (FIX-3 — additive merge, not plain idempotency):
   - Fetch all application_ids already linked via InspectionApplication
   - Find which of the pending applications from step 2 are NOT yet linked
   - Create InspectionApplication rows for the new ones
   - Return the updated inspection with its FULL set of linked applications
   Why: handles the case where the applicant submitted new approvals needing
   inspection after the first bundle was created — plain "return as-is"
   would silently ignore the new applications.
6. IF NOT EXISTS:
   - Create new Inspection (scheduled_date = now+7, status='scheduled',
     assigned_inspector_id if provided)
   - Create InspectionApplication join rows for all found applications
   - Return bundled inspection
```

**`getInspections(req, res)`**
- List inspections for applicant, including linked Applications → ApprovalRule and Inspector info.

**`assignInspector(req, res)`**
- Admin-only. Verify target user has role='inspector'. Set and save.

**`completeInspection(req, res)`**
```
Auth: inspector (must be assigned_inspector_id for THIS inspection) or admin.
Validation: inspection.status must be 'scheduled'.

1. Update Inspection: status='completed', result, inspector_notes
2. For each linked Application:
   - result='pass'        → status='approved', decided_at=now
   - result='fail'        → status='rejected', decided_at=now
   - result='conditional' → status='pending_review' (officer desk-reviews notes)
3. Return updated inspection + application statuses
```

### Routes

| Method | Path | Auth | Handler |
|---|---|---|---|
| POST | `/api/inspections/bundle` | authenticate | `bundleInspections` |
| GET | `/api/inspections/:applicantId` | authenticate | `getInspections` |
| PATCH | `/api/inspections/:inspectionId/assign` | authenticate, authorize('admin') | `assignInspector` |
| PATCH | `/api/inspections/:inspectionId/complete` | authenticate, authorize('inspector','admin') | `completeInspection` |

---

### Priority 3 Verification

```bash
# Bundle → single inspection with multiple linked applications
# Call bundle again with no new pending_inspection apps → same inspection, no new links
# Submit a NEW application that also needs inspection, call bundle again →
#   the existing scheduled inspection now includes this new application too (proves FIX-3)
# Assign inspector, complete as that inspector → linked applications update
# Try completing as a different inspector → 403
```

---

## Priority 4: SLA Escalation + Notifications (PRD §5.7)

### Models

#### [NEW] `src/models/Notification.js`

| Field | Type | Notes |
|---|---|---|
| `id` | INTEGER, PK, autoIncrement | |
| `user_id` | INTEGER, not null | FK to User |
| `type` | ENUM('sla_warning','sla_breach','grievance_update','application_update','scheme_recommendation') | |
| `title` | STRING, not null | |
| `message` | TEXT, not null | |
| `reference_type` | STRING, nullable | 'application', 'grievance', 'inspection' |
| `reference_id` | INTEGER, nullable | |
| `is_read` | BOOLEAN, default false | |
| `created_at` | DATE, default NOW | |

#### Associations

```js
Notification.belongsTo(User, { foreignKey: 'user_id' });
User.hasMany(Notification, { foreignKey: 'user_id' });
```

#### [MODIFY] `src/models/Application.js`

Add: `last_notified_level: { type: DataTypes.ENUM('none','warning','breach'), defaultValue: 'none' }`

### Service — Recipients Include Inspectors (FIX-4)

#### [NEW] `src/services/slaEscalationService.js` (new `src/services/` directory)

```js
async function checkAndEscalate() {
  // ...fetch non-terminal applications with ApprovalRule...
  for (const app of applications) {
    const daysLeft = Math.ceil((new Date(app.sla_deadline) - now) / (1000*60*60*24));
    const rule = app.ApprovalRule;

    if (daysLeft <= 2 && daysLeft >= 0 && app.last_notified_level !== 'warning') {
      // FIX-4: Query BOTH officers AND inspectors for this department.
      // Why: applications in 'pending_inspection' status are handled by inspectors,
      // not officers. If a department only has inspectors staffed (no officer),
      // querying only role='officer' means zero notifications — a silent failure.
      const recipients = await User.findAll({
        where: {
          role: { [Op.in]: ['officer', 'inspector'] },
          department: rule.department,
        },
      });
      // ...create sla_warning notifications for each recipient...
      app.last_notified_level = 'warning';
      await app.save();
    }

    if (daysLeft < 0 && app.last_notified_level !== 'breach') {
      // For breaches: department officers+inspectors PLUS all admins
      const deptStaff = await User.findAll({
        where: {
          role: { [Op.in]: ['officer', 'inspector'] },
          department: rule.department,
        },
      });
      const admins = await User.findAll({ where: { role: 'admin' } });
      const recipients = [...deptStaff, ...admins];
      // ...create sla_breach notifications...
      app.last_notified_level = 'breach';
      await app.save();
    }
  }
  return { warnings_sent, breaches_sent };
}
```

### Controller

#### [NEW] `src/controllers/notificationController.js`

- `getMyNotifications` — findAll where user_id = req.user.id, order by created_at DESC, limit 50
- `markAsRead` — find by PK, **verify user_id matches req.user.id** (prevents cross-user marking), set is_read = true
- `markAllRead` — update is_read=true where user_id = req.user.id and is_read = false

### Routes

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | `/api/notifications` | authenticate | `getMyNotifications` |
| PATCH | `/api/notifications/:id/read` | authenticate | `markAsRead` |
| PATCH | `/api/notifications/read-all` | authenticate | `markAllRead` |

#### [MODIFY] `src/routes/adminRoutes.js`

Add: `POST /api/admin/run-sla-check` — admin/officer only, calls checkAndEscalate(), returns summary.

#### [MODIFY] `src/server.js`

```js
const cron = require('node-cron');
const { checkAndEscalate } = require('./services/slaEscalationService');
// After app.listen():
cron.schedule('*/5 * * * *', () => {
  console.log('Running scheduled SLA escalation check...');
  checkAndEscalate().catch(err => console.error('SLA cron error:', err));
});
```

#### [MODIFY] `package.json` — add `"node-cron": "^3.0.3"`

---

### Priority 4 Verification

```bash
npm install && npm run seed && npm start
# POST /api/admin/run-sla-check → { warnings_sent, breaches_sent }
# CRITICAL (FIX-4 proof): Create an application in pending_inspection status,
#   past its SLA deadline, in a department staffed ONLY by an inspector (no officer).
#   Run SLA check → verify the INSPECTOR receives a notification.
```

---

## Priority 5: Grievance Redressal (PRD §5.8) + Auto-Escalation (FIX-5)

### Model

#### [NEW] `src/models/Grievance.js`

| Field | Type | Notes |
|---|---|---|
| `id` | INTEGER, PK, autoIncrement | |
| `applicant_id` | INTEGER, not null | FK to ApplicantProfile |
| `application_id` | INTEGER, nullable | FK to Application |
| `subject` | STRING, not null | |
| `description` | TEXT, not null | |
| `status` | ENUM('open','in_progress','escalated','resolved','closed') | Default: 'open' |
| `priority` | ENUM('low','medium','high') | Default: 'medium' |
| `assigned_to` | INTEGER, nullable | FK to User |
| `resolution_notes` | TEXT, nullable | |
| `escalation_level` | INTEGER, default 0 | Range 0–3 |
| `sla_deadline` | DATE | Auto-set to now + 7 days |
| `created_at` | DATE, default NOW | |
| `resolved_at` | DATE, nullable | |

### Associations

```js
Grievance.belongsTo(ApplicantProfile, { foreignKey: 'applicant_id' });
ApplicantProfile.hasMany(Grievance, { foreignKey: 'applicant_id' });
Grievance.belongsTo(Application, { foreignKey: 'application_id' });
Application.hasMany(Grievance, { foreignKey: 'application_id' }); // both directions
Grievance.belongsTo(User, { as: 'AssignedOfficer', foreignKey: 'assigned_to' });
```

### Controller

#### [NEW] `src/controllers/grievanceController.js`

- `createGrievance` — validate profile; if application_id given, validate it belongs to applicant; auto-set sla_deadline = now+7; status='open', escalation_level=0.
- `getMyGrievances` — look up profile by req.user.id; **if no profile, return []** (not 404); include Application for context.
- `getAssignedGrievances` — where assigned_to = req.user.id; order by priority DESC, created_at ASC.
- `updateGrievanceStatus` — validate status enum; if resolved/closed set resolved_at; validate assigned_to target role.
- `escalateGrievance` — **block if resolved/closed** (400); block if level >= 3 (400); bump level, set status='escalated'; if level >= 2, reassign to admin.

### Auto-Escalation via Cron (FIX-5)

#### [MODIFY] `src/services/slaEscalationService.js`

Add a second exported function:

```js
async function checkGrievanceEscalations() {
  // FIX-5: The PRD promises "time-bound escalation" but a manually-called
  // escalateGrievance endpoint alone doesn't deliver that — nothing currently
  // checks grievance SLA deadlines automatically. This function runs on the
  // same cron schedule as checkAndEscalate().
  const now = new Date();
  const overdue = await Grievance.findAll({
    where: {
      sla_deadline: { [Op.lt]: now },
      status: { [Op.notIn]: ['resolved', 'closed'] },
      escalation_level: { [Op.lt]: 3 },
    },
  });
  let escalated = 0;
  for (const g of overdue) {
    g.escalation_level += 1;
    g.status = 'escalated';
    if (g.escalation_level >= 2) {
      const admin = await User.findOne({ where: { role: 'admin' } });
      g.assigned_to = admin ? admin.id : g.assigned_to;
    }
    await g.save();
    // Notify the applicant that their grievance was auto-escalated
    const profile = await ApplicantProfile.findByPk(g.applicant_id);
    if (profile) {
      await Notification.create({
        user_id: profile.user_id,
        type: 'grievance_update',
        title: `Grievance auto-escalated: ${g.subject}`,
        message: `Your grievance has been automatically escalated to level ${g.escalation_level} due to SLA breach.`,
        reference_type: 'grievance',
        reference_id: g.id,
      });
    }
    escalated++;
  }
  return { grievances_escalated: escalated };
}
```

#### [MODIFY] `src/server.js` cron schedule

```js
cron.schedule('*/5 * * * *', async () => {
  console.log('Running scheduled SLA + grievance escalation check...');
  const sla = await checkAndEscalate().catch(err => { console.error(err); return {}; });
  const grv = await checkGrievanceEscalations().catch(err => { console.error(err); return {}; });
  console.log('Results:', sla, grv);
});
```

#### [MODIFY] `POST /api/admin/run-sla-check` response

Return combined results: `{ warnings_sent, breaches_sent, grievances_escalated }`.

### Routes

| Method | Path | Auth | Handler |
|---|---|---|---|
| POST | `/api/grievances` | authenticate | `createGrievance` |
| GET | `/api/grievances/mine` | authenticate | `getMyGrievances` |
| GET | `/api/grievances/assigned` | authenticate, authorize('officer','admin') | `getAssignedGrievances` |
| PATCH | `/api/grievances/:id` | authenticate, authorize('officer','admin') | `updateGrievanceStatus` |
| POST | `/api/grievances/:id/escalate` | authenticate | `escalateGrievance` |

---

### Priority 5 Verification

```bash
# Full lifecycle: create → assign → manual escalate → resolve → try escalating resolved → 400
# FIX-5 proof: create a grievance with sla_deadline in the past (via seed data),
#   run /api/admin/run-sla-check → verify it auto-escalates without manual /escalate call,
#   AND verify the applicant receives a grievance_update notification
```

---

## Priority 6: Approval Rule Management API (PRD §5.1) + Soft-Delete (FIX-6)

### Controller

#### [NEW] `src/controllers/approvalRuleController.js`

- `listRules` — filterable by sector/state/stage query params, paginated via findAndCountAll. **If `is_active` field exists, default filter to `is_active: true`.**
- `createRule` — validate required fields (sector, state, approval_name, department, required_documents as non-empty array); validate enums.
- `updateRule` — partial update, same validation, 404 if not found.
- `deleteRule` (FIX-6):

```js
async function deleteRule(req, res) {
  const rule = await ApprovalRule.findByPk(req.params.id);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });

  // FIX-6: Block deletion if ANY application references this rule — including
  // terminal (approved/rejected) ones. Why: those Application rows still have
  // approval_rule_id as a FK, and adminController.getAnalytics does
  // `include: [{ model: ApprovalRule }]` which would return null for the deleted
  // rule, crashing on `a.ApprovalRule.department`.
  const anyApps = await Application.count({ where: { approval_rule_id: rule.id } });
  if (anyApps > 0) {
    // Soft-delete: mark inactive instead of destroying
    rule.is_active = false;
    await rule.save();
    return res.json({
      message: 'Rule deactivated (has existing applications). It will no longer appear in new checklists.',
      rule,
    });
  }

  // Hard-delete: no applications reference this rule, safe to destroy
  await rule.destroy();
  res.json({ message: 'Rule deleted' });
}
```

#### [MODIFY] `src/models/ApprovalRule.js`

Add: `is_active: { type: DataTypes.BOOLEAN, defaultValue: true }`

#### [MODIFY] `src/controllers/checklistController.js` and `applicationController.js`

Add `is_active: true` to the rule-matching where clause so deactivated rules stop appearing in checklists and submissions.

### Routes

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | `/api/approval-rules` | authenticate, authorize('admin','officer') | `listRules` |
| POST | `/api/approval-rules` | authenticate, authorize('admin') | `createRule` |
| PUT | `/api/approval-rules/:id` | authenticate, authorize('admin') | `updateRule` |
| DELETE | `/api/approval-rules/:id` | authenticate, authorize('admin') | `deleteRule` |

---

### Priority 6 Verification

```bash
# Create a rule, list, update, delete (no apps → hard delete, success)
# Create a rule, generate an application against it, delete → soft-delete (is_active=false)
# Verify checklist engine no longer returns the deactivated rule
```

---

## Priority 7: Enhanced Analytics (PRD §5.10)

#### [MODIFY] `src/controllers/adminController.js`

Add to `getAnalytics` (reusing already-loaded `allApplications`, no extra queries):

**7a. avg_processing_time_by_department** — average (decided_at - submitted_at) in days for terminal-status apps.

**7b. weekly_submission_trend** — applications per week for last 4 weeks, using `week_start`/`week_end` date strings.

**7c. top_bottleneck_departments** — departments sorted by pending count descending, as array.

---

## Priority 8: Lightweight Audit Logging

### Model

#### [NEW] `src/models/AuditLog.js`

| Field | Type | Notes |
|---|---|---|
| `id` | INTEGER, PK, autoIncrement | |
| `actor_user_id` | INTEGER, not null | |
| `action` | STRING, not null | |
| `entity_type` | STRING, not null | |
| `entity_id` | INTEGER, not null | |
| `previous_status` | STRING, nullable | |
| `new_status` | STRING, nullable | |
| `notes` | TEXT, nullable | |
| `created_at` | DATE, default NOW | |

Association: `AuditLog.belongsTo(User, { as: 'Actor', foreignKey: 'actor_user_id' })`

### Integration (inline, not middleware)

- `applicationController.decideApplication` — capture previousStatus BEFORE update
- `inspectionController.completeInspection` — log inspection + each linked application change
- `grievanceController.updateGrievanceStatus` and `escalateGrievance`

### Endpoint

`adminController.getAuditLog` — paginated, filterable by entity_type/entity_id, include Actor.

Route: `GET /api/admin/audit-log` (admin-only).

---

## Cross-Cutting Changes

### [MODIFY] `src/models/index.js`

All new models + associations (including both-direction Grievance↔Application, Notification↔User, AuditLog→User).

### [MODIFY] `src/app.js`

Mount: `/api/grievances`, `/api/inspections`, `/api/notifications`, `/api/approval-rules`.

### [MODIFY] `src/seed/seed.js`

Full demo data in dependency order (users with bcrypt.hashSync → rules → schemes → profile → vault docs → applications with varied statuses/SLA deadlines → inspection → grievances with one past-SLA for FIX-5 demo → notifications). Include at least one department staffed ONLY by an inspector (no officer) for FIX-4 demo.

---

## File Change Summary

| Action | File | Key Changes |
|---|---|---|
| MODIFY | `src/models/User.js` | inspector role + department |
| MODIFY | `src/models/Application.js` | last_notified_level |
| MODIFY | `src/models/DocumentVault.js` | expiry_date |
| MODIFY | `src/models/ApprovalRule.js` | is_active (FIX-6) |
| MODIFY | `src/models/index.js` | 5 new models + all associations |
| MODIFY | `src/controllers/authController.js` | department in register/login/JWT |
| MODIFY | `src/controllers/applicationController.js` | doc validation, idempotency, fail-closed dept scoping (FIX-2), is_active filter, audit log |
| MODIFY | `src/controllers/vaultController.js` | dynamic pre-validation (FIX-1) |
| MODIFY | `src/controllers/checklistController.js` | is_active filter (FIX-6) |
| MODIFY | `src/controllers/adminController.js` | enhanced analytics + getAuditLog |
| MODIFY | `src/routes/adminRoutes.js` | SLA check + audit log endpoints |
| MODIFY | `src/app.js` | mount 4 new route modules |
| MODIFY | `src/server.js` | node-cron for SLA + grievance escalation |
| MODIFY | `src/seed/seed.js` | full demo data with bcrypt + edge-case scenarios |
| MODIFY | `package.json` | add node-cron |
| NEW | `src/models/Grievance.js` | |
| NEW | `src/models/Inspection.js` | |
| NEW | `src/models/InspectionApplication.js` | |
| NEW | `src/models/Notification.js` | |
| NEW | `src/models/AuditLog.js` | |
| NEW | `src/controllers/grievanceController.js` | 5 functions |
| NEW | `src/controllers/inspectionController.js` | 4 functions (bundle w/ FIX-3, get, assign, complete) |
| NEW | `src/controllers/notificationController.js` | 3 functions |
| NEW | `src/controllers/approvalRuleController.js` | 4 functions (CRUD w/ FIX-6) |
| NEW | `src/services/slaEscalationService.js` | checkAndEscalate (FIX-4) + checkGrievanceEscalations (FIX-5) |
| NEW | `src/routes/grievanceRoutes.js` | 5 routes |
| NEW | `src/routes/inspectionRoutes.js` | 4 routes |
| NEW | `src/routes/notificationRoutes.js` | 3 routes |
| NEW | `src/routes/approvalRuleRoutes.js` | 4 routes |

**Total: 15 modified + 14 new = 29 files**
