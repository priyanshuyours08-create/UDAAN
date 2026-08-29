# Product Requirements Document (PRD)

## UDAAN — Unified Digital Approval & Assistance Network
**SIH Problem Statement:** PS-130 — Efficiency in Streamlining Industrial Approvals, Compliance Processes, and Access to Government Support Services

**Version:** 1.0
**Status:** Draft for SIH submission

---

## 1. Executive Summary

UDAAN is an AI-powered, unified platform that dynamically determines the exact set of approvals, licences, and NOCs an industrial unit needs — based on sector, location, project scale, and lifecycle stage — then guides the applicant through documentation, pre-validates submissions, coordinates parallel departmental workflows, schedules joint inspections, and surfaces applicable government incentive schemes, all from a single dashboard.

Unlike static single-window portals, UDAAN is built around a **Regulatory Knowledge Graph** and a **Risk-Based Scrutiny Engine**, so the system adapts per-applicant instead of relying on hardcoded checklists — making it scalable across states, sectors, and future regulatory changes.

---

## 2. Problem Statement (Summary)

- Entrepreneurs must navigate multiple approvals across different departments, with requirements varying by sector, location, size, and stage.
- Applicants struggle to identify applicable approvals, meet documentation requirements, track timelines, and access incentives.
- Departments face incomplete applications, duplicate scrutiny, manual coordination, poor delay visibility, and inconsistent compliance monitoring.

---

## 3. Goals & Success Metrics

| Goal | Metric | Target (illustrative) |
|---|---|---|
| Reduce approval time | Avg. days from application to final approval | ↓ 40% vs baseline |
| Reduce incomplete applications | % applications rejected/returned for missing docs | ↓ 60% |
| Improve transparency | % applicants with real-time status visibility | 100% |
| Reduce compliance cost | Avg. no. of physical department visits per unit | ↓ 70% |
| Improve scheme utilization | % eligible units availing at least 1 incentive scheme | ↑ 50% |
| Reduce inspection burden | Avg. no. of separate inspections per unit per year | ↓ via joint inspection bundling |

---

## 4. User Personas

1. **Entrepreneur / Industrial Unit Applicant** — needs clarity, guidance, single point of tracking.
2. **Department Officer / Scrutiny Officer** — needs complete applications, reduced duplication, clear queue prioritization.
3. **Inspector** — needs consolidated inspection schedules and checklists.
4. **Nodal Agency / Single Window Admin** — needs cross-department visibility, bottleneck analytics, escalation control.
5. **Policy Maker / Department Head** — needs dashboards on delays, scheme uptake, and process health.

---

## 5. Core Modules

### 5.1 Regulatory Knowledge Engine (Dynamic Checklist Generator)
- Graph-based rule engine mapping: Sector (NIC code) × Location (state/district/zone) × Project scale (investment, land, power load, employee count) × Stage (pre-establishment, construction, operational, renewal) → required approvals.
- Rules maintained centrally by department admins via a no-code rule builder (so it scales without engineering effort per new regulation).
- Outputs a personalized, sequenced checklist with document requirements per approval.

### 5.2 Applicant Journey & Data Reuse Vault
- Guided application wizard with contextual help per document.
- One-time KYC/data capture: Udyam, GSTIN, PAN, land title/lease, DigiLocker-integrated document fetch.
- "Verified Once" data vault — reused automatically across every department's application, eliminating repeat submission.
- Auto-fill of department-specific forms from vault data.

### 5.3 Pre-Validation & Auto-Scrutiny
- Rule-based + ML document validation (format checks, expiry checks, cross-field consistency, missing-field detection) before submission — reduces "incomplete application" rejections at source.
- OCR-based extraction and validation for scanned documents.

### 5.4 Risk-Based Scrutiny & Approval Routing
- Risk score per applicant based on: sector hazard classification, self-certification eligibility, compliance/violation history, project scale.
- Routing: Green (auto-approve/self-certify), Yellow (desk scrutiny), Red (full scrutiny + inspection).

### 5.5 Parallel Workflow Orchestration
- Workflow engine triggers dependent and independent departmental processes in parallel (not sequentially) wherever legally permissible.
- Dependency mapping so applicants/departments see what's blocking what.

### 5.6 Common Inspection Planner
- Detects overlapping inspection requirements across departments (Fire, Pollution, Factories, Labour, etc.) for the same unit/location.
- Auto-schedules a bundled joint inspection with a shared checklist, reducing visits and coordination overhead.

### 5.7 SLA Tracking, Alerts & Escalation
- Statutory SLA clock per approval type; auto-alerts to officers nearing breach.
- Auto-escalation matrix to next authority on SLA breach.
- Applicant-facing real-time status + notification (SMS/email/app).

### 5.8 Grievance Redressal
- In-app grievance ticketing linked to specific application/approval stage.
- Time-bound escalation hierarchy with resolution tracking.

### 5.9 Incentive & Scheme Matching Engine
- Matches applicant profile (sector, location, investment, employment generated) against a scheme database (state + central).
- Proactively notifies eligible schemes/subsidies and guides application.

### 5.10 Unified Analytics Dashboard
- For admins/policy makers: bottleneck heatmaps by department/approval type, delay trend analysis, predictive SLA-breach flags (ML-based), scheme uptake analytics.
- For applicants: single dashboard of all applications, approvals, renewals due, and incentives availed.

---

## 6. Functional Requirements (Sample)

| ID | Requirement |
|---|---|
| FR-1 | System shall generate a personalized approval checklist based on sector, location, scale, and stage inputs. |
| FR-2 | System shall allow one-time document upload reused across all applicable departmental applications. |
| FR-3 | System shall validate submitted documents against defined rules before allowing submission. |
| FR-4 | System shall assign a risk score and route applications accordingly. |
| FR-5 | System shall detect and bundle overlapping inspection requirements across departments. |
| FR-6 | System shall track SLA timelines per approval and trigger alerts/escalations on breach risk. |
| FR-7 | System shall recommend applicable incentive schemes based on applicant profile. |
| FR-8 | System shall provide role-based dashboards for applicants, officers, inspectors, and admins. |
| FR-9 | System shall support grievance logging linked to specific application stages with escalation tracking. |
| FR-10 | System shall provide analytics on delays, bottlenecks, and scheme utilization. |

## 7. Non-Functional Requirements

- **Security:** Role-based access control, encrypted data at rest/in transit, audit logs for every scrutiny action.
- **Interoperability:** API integration with DigiLocker, Udyam, GSTIN, state land record systems, PAN verification.
- **Scalability:** Rule engine must support onboarding new states/sectors without code changes.
- **Availability:** 99.5%+ uptime target for citizen-facing portal.
- **Accessibility:** Multi-lingual UI, mobile-responsive, WCAG-compliant for accessibility.
- **Auditability:** Immutable log of all approvals/rejections for statutory compliance (e.g., append-only audit trail).

---

## 8. Suggested Tech Stack

- **Frontend:** React.js / Next.js (citizen portal + admin dashboard), React Native or PWA for mobile.
- **Backend:** Node.js (NestJS) or Python (FastAPI/Django) microservices.
- **Rule/Knowledge Engine:** Graph DB (Neo4j) or a rules engine (Drools) for the Regulatory Knowledge Graph.
- **ML components:** Python (scikit-learn/XGBoost for risk scoring & delay prediction), OCR via Tesseract/Cloud Vision for document validation.
- **Database:** PostgreSQL (transactional), Neo4j (regulatory graph), Redis (caching/queues).
- **Workflow orchestration:** Camunda / Temporal for parallel departmental workflow management.
- **Integrations:** DigiLocker API, Udyam Registration API, GSTIN verification API, state land record APIs, SMS/Email gateway.
- **Infra:** Cloud-hosted (MeghRaj/NIC cloud for govt deployment feasibility), Docker/Kubernetes.

---

## 9. High-Level User Flow

1. Applicant registers → enters sector, location, project scale, stage.
2. System generates dynamic checklist + estimated timeline.
3. Applicant uploads documents once → auto-validated → auto-filled into relevant department forms.
4. Risk engine scores application → routes to auto-approval / desk scrutiny / inspection.
5. Parallel workflows trigger across relevant departments simultaneously.
6. If inspections needed, common inspection scheduler bundles them.
7. SLA tracker monitors each stage; alerts/escalates on delay risk.
8. Applicant receives approvals on dashboard; system recommends matching incentive schemes.
9. Renewals tracked automatically with pre-expiry reminders.
10. Any grievance can be raised against a specific stage, with tracked escalation.

---

## 10. Hackathon MVP Scope (What to actually build in the time available)

Given hackathon time constraints, build a working slice, not the whole system:

1. Dynamic checklist generator (pick 2–3 sectors × 1 state, rule engine working end-to-end).
2. One-time document vault with reuse across 2 mock departments.
3. Basic risk-scoring logic (rule-based is fine, ML optional stretch goal).
4. SLA tracker with mock timeline + alert simulation.
5. Applicant dashboard + one admin analytics view (bottleneck chart).
6. Scheme-matching engine with a small sample scheme database (5–10 schemes).

Stretch goals (mention in pitch as roadmap, don't over-promise as built): common inspection scheduler, ML-based delay prediction, DigiLocker live integration.

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Integration with real govt APIs (DigiLocker, Udyam) may be restricted/unavailable during hackathon | Use sandbox/mock APIs; clearly label as simulated in demo |
| Rule engine complexity across many sectors/states | Scope MVP to 2–3 sectors and 1 state; show extensibility |
| Statutory safeguards vs speed trade-off (risk of overpromising "auto-approval") | Keep human-in-the-loop for all Red/Yellow risk cases; auto-approval only for pre-defined low-risk self-certification categories already permitted by policy |
| Data privacy of sensitive business data in vault | Encryption, access logs, consent-based sharing model |

---

## 12. Differentiation Summary (for pitch deck)

| Typical Single-Window Portal | UDAAN |
|---|---|
| Static checklist per sector | Dynamic graph-based checklist (sector × location × scale × stage) |
| Manual document re-submission per dept | One-time verified data vault, reused everywhere |
| Fixed inspection schedule | Risk-based routing + common inspection bundling |
| Reactive delay reporting | Predictive delay/SLA-breach flagging |
| Passive scheme listing | Proactive, profile-matched scheme recommendation |
