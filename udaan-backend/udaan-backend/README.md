# UDAAN Backend — SIH PS-130

Unified Digital Approval & Assistance Network — backend MVP.

Implements the core differentiators from the PRD:
- **Dynamic checklist generation** (Regulatory Knowledge Graph, simplified as a rules table)
- **One-time document vault** ("verify once, reuse everywhere")
- **Risk-based scrutiny & routing** (auto-approve / desk review / inspection)
- **Parallel application tracking with SLA countdown**
- **Scheme-matching engine**
- **Admin bottleneck/delay analytics**

This has been built and tested end-to-end (every endpoint below was verified working).

## 1. Setup

```bash
npm install
cp .env.example .env
npm run seed      # creates tables + loads sample approval rules & schemes
npm start          # starts server on http://localhost:4000
```

Uses SQLite by default (zero setup — a `udaan.sqlite` file is created automatically).
To switch to Postgres for a "real" deployment, edit `.env`:
```
DB_DIALECT=postgres
DB_HOST=...
DB_PORT=5432
DB_NAME=udaan
DB_USER=...
DB_PASSWORD=...
```
No code changes needed — `src/config/database.js` already handles both.

## 2. Sample data seeded

- **14 approval rules** across `food_processing` and `textile` sectors in Madhya Pradesh
  (Udyam, Factory License, Pollution NOC, Fire NOC, FSSAI, GST, etc.), each with
  investment thresholds, hazard levels, and SLA days — this is what the dynamic
  checklist engine queries against.
- **6 government schemes** (MP Industrial Investment Promotion, PMEGP, PLISFPI, TUFS,
  Stamp Duty Exemption, Employment Generation Subsidy).

Edit `src/seed/seed.js` to add more sectors/states/schemes — no other code changes needed.

## 3. API Walkthrough (matches the PRD's user flow)

### Register & login
```
POST /api/auth/register   { name, email, password, role? }  -> { token, user }
POST /api/auth/login      { email, password }                -> { token, user }
```
`role` is one of `applicant` (default), `officer`, `admin`.
All routes below require `Authorization: Bearer <token>`.

### Create applicant profile
```
POST /api/applicant/profile
{
  "business_name": "Ravi Foods Pvt Ltd",
  "sector": "food_processing",
  "state": "Madhya Pradesh",
  "investment_amount": 80,
  "employee_count": 40,
  "stage": "pre_establishment"
}
```

### Get the dynamic checklist — THE CORE FEATURE
```
GET /api/checklist/:applicantId
```
Returns only the approvals that actually apply, based on sector + state + stage +
investment range — pulled live from the ApprovalRule table (`src/controllers/checklistController.js`).
Add a new row to that table and every matching applicant's checklist updates automatically.

### Upload a document to the vault (once, reused everywhere)
```
POST /api/vault/upload
{ "applicant_id": 1, "document_type": "PAN", "file_url": "https://..." }

GET /api/vault/:applicantId   -> list everything already verified for this applicant
```

### Submit application — generates one row per required approval, risk-scores & routes each
```
POST /api/applications/submit
{ "applicant_id": 1 }
```
Internally: re-runs the checklist query, then for each approval computes a risk level
(`src/controllers/riskEngine.js`) and routes it:
- `low` risk    -> `auto_approved`
- `medium` risk -> `pending_review`
- `high` risk   -> `pending_inspection`

### Track status with live SLA countdown
```
GET /api/applications/:applicantId
```
Returns each approval's status, risk level, and `days_left` until SLA deadline
(negative = breached).

### Officer/admin: approve or reject a pending application
```
PATCH /api/applications/:applicationId/decide   (role: officer or admin)
{ "decision": "approved" }   // or "rejected"
```

### Scheme matching
```
GET /api/schemes/match/:applicantId
```
Returns government incentive schemes the applicant is eligible for, based on
sector/state/investment/employee count.

### Admin analytics dashboard
```
GET /api/admin/analytics   (role: officer or admin)
```
Returns status breakdown, count of applications at risk of / already breaching SLA,
and a bottleneck view by department — this is what powers the delay-analytics module
from the PRD.

## 4. Project structure

```
src/
  config/database.js       # SQLite (dev) / Postgres (prod) switch
  models/                  # Sequelize models: User, ApplicantProfile,
                            #   ApprovalRule, Application, DocumentVault, Scheme
  controllers/              # business logic per module
  routes/                   # Express route definitions
  middleware/auth.js        # JWT authentication + role-based authorization
  seed/seed.js               # sample approval rules + schemes
  app.js                    # Express app + route mounting
  server.js                 # DB connect + sync + listen
```

## 5. What to build next (frontend / stretch goals)

- Frontend dashboard consuming these APIs (applicant view + admin view)
- Common inspection scheduler (detect overlapping `requires_inspection` rules
  for the same applicant and bundle them into one visit)
- Replace `riskEngine.js`'s rule-based scoring with an ML model trained on
  historical compliance data (same function signature, drop-in replacement)
- Real DigiLocker / Udyam / GSTIN API integration in `vaultController.js`
  (currently mocked as auto-verified on upload)
