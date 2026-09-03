# Analytics API Documentation

## Overview & Scope
All endpoints are available under `/api/admin/analytics`. They are protected by JWT authentication and RBAC (`authorize('admin', 'officer')`).
- **Global Scope**: Admins calling without a `department` parameter view global statistics (including unclassified records where applicable).
- **Department Scope**:
  - Officers are strictly scoped to their assigned canonical department.
  - Admins may filter by appending `?department=<canonical_department_name>`.

## Date Semantics & Query Validation
- Date fields expect ISO-8601 strings with an explicit `Z` or offset (e.g., `2025-09-01T00:00:00.000Z`).
- Date-only formats (e.g., `2025-09-01`) or impossible calendar dates (e.g., `2026-02-30`) are rejected (400 Bad Request).
- When a range is requested:
  - Both `startDate` and `endDate` must be provided, or both omitted.
  - If omitted, a default historical range of the previous 30 days is applied.
  - `startDate` is inclusive, `endDate` is exclusive.
  - Maximum allowed historical range is 366 days.
- Arrays or repeated query keys are strictly rejected (400 Bad Request).

## Formulas
- **Bottleneck Score**: `pending_applications + (2 * breached_pending_applications) + (2 * unresolved_high_escalation_grievances)`
- **Inspection Duration**: `average(completed_at - createdAt)` (where `status = 'completed'`)
- **Grievance Resolution**: `average(resolved_at - createdAt)` (where `status` in `'resolved', 'closed'`)

## Endpoints

### 1. Overview
`GET /api/admin/analytics/overview`
*(Legacy alias: `GET /api/admin/analytics`)*
- **Purpose**: High-level application funnel and decision rates within a historical range, plus the current pending workload.
- **Query Params**: `startDate`, `endDate`, `department`
- **Response**:
```json
{
  "success": true,
  "generated_at": "2026-09-01T00:00:00.000Z",
  "historical_range": {
    "start": "2025-09-01T00:00:00.000Z",
    "end": "2026-09-01T00:00:00.000Z"
  },
  "current_state_scope": "all_active_records",
  "department_scope": null,
  "data": {
    "applications_submitted_in_range": 100,
    "decisions_completed_in_range": 80,
    "application_statuses": { ... },
    "approval_rate_for_decisions_in_range": { "rate": 80.0, "numerator": 64, "denominator": 80 },
    "rejection_rate_for_decisions_in_range": { "rate": 20.0, "numerator": 16, "denominator": 80 },
    "auto_approval_rate_for_decisions_in_range": { "rate": 0.0, "numerator": 0, "denominator": 80 },
    "average_turnaround_for_decisions_in_range": { "average_hours": 48.5, "sample_size": 80 },
    "pending_workload": 20
  }
}
```

### 2. SLA
`GET /api/admin/analytics/sla`
- **Purpose**: Current state snapshot of pending applications against their SLA deadlines. No historical bounds.
- **Query Params**: `department`
- **Response**:
```json
{
  "generated_at": "2026-09-01T00:00:00.000Z",
  "historical_range": null,
  "current_state_scope": "all_active_records",
  "department_scope": null,
  "data": {
    "warning_hours": 48,
    "pending_workload": 20,
    "sla_state": { "breached": 2, "warning": 5, "on_track": 10, "missing_deadline": 3 },
    "notification_levels_for_pending": { "none": 10, "warning": 8, "breach": 2 }
  }
}
```

### 3. Departments (Bottlenecks)
`GET /api/admin/analytics/departments`
- **Purpose**: Departmental workload bottleneck comparison. Returns an array of departments ranked by highest bottleneck score, tied-broken by average pending age.
- **Query Params**: `department`
- **Response**:
```json
{
  "generated_at": "2026-09-01T00:00:00.000Z",
  "historical_range": null,
  "current_state_scope": "all_active_records",
  "department_scope": null,
  "data": {
    "formula": "pending_applications + (2 * breached_pending_applications) + (2 * unresolved_high_escalation_grievances)",
    "departments": [
      {
        "department": "Fire",
        "pending_applications": 10,
        "breached_pending_applications": 2,
        "unresolved_high_escalation_grievances": 1,
        "average_pending_age_hours": 150.5,
        "age_sample_size": 10,
        "bottleneck_score": 16
      }
    ]
  }
}
```

### 4. Inspections
`GET /api/admin/analytics/inspections`
- **Purpose**: Historical throughput and current state queue for inspections. Multi-application joint inspections are safely deduplicated to avoid over-counting.
- **Query Params**: `startDate`, `endDate`, `department`
- **Response**:
```json
{
  "success": true,
  "generated_at": "2026-09-01T00:00:00.000Z",
  "historical_range": {
    "start": "2025-09-01T00:00:00.000Z",
    "end": "2026-09-01T00:00:00.000Z"
  },
  "current_state_scope": "all_active_records",
  "department_scope": null,
  "data": {
    "completed_inspections_in_range": 50,
    "inspection_results": { "pass": 45, "fail": 3, "conditional": 2 },
    "average_inspection_duration": { "avg_hours": 72.0, "sample_size": 50 },
    "unassigned_scheduled_inspections": 12
  }
}
```

### 5. Grievances
`GET /api/admin/analytics/grievances`
- **Purpose**: Grievance tracking metrics including both historical resolution timelines and current active escalation tiers.
- **Query Params**: `startDate`, `endDate`, `department`
- **Response**:
```json
{
  "success": true,
  "generated_at": "2026-09-01T00:00:00.000Z",
  "historical_range": {
    "start": "2025-09-01T00:00:00.000Z",
    "end": "2026-09-01T00:00:00.000Z"
  },
  "current_state_scope": "all_active_records",
  "department_scope": null,
  "data": {
    "grievances_created_in_range": 30,
    "grievance_statuses": { "open": 5, "in_progress": 5, "escalated": 2, "resolved": 15, "closed": 3 },
    "grievances_resolved_in_range": 18,
    "average_grievance_resolution_time": { "avg_hours": 120.0, "sample_size": 18 },
    "unresolved_grievances": 12,
    "unresolved_grievance_levels": { "0": 5, "1": 3, "2": 2, "3": 2 }
  }
}
```

### 6. Trends
`GET /api/admin/analytics/trends`
- **Purpose**: Pre-aggregated time-series cohorts across five metrics bounded by strict UTC calendar alignments (`day`, `week`, `month`).
- **Query Params**: `startDate`, `endDate`, `department`, `interval`
- **Response**:
```json
{
  "success": true,
  "generated_at": "2026-09-01T00:00:00.000Z",
  "historical_range": {
    "start": "2025-09-01T00:00:00.000Z",
    "end": "2026-09-01T00:00:00.000Z"
  },
  "current_state_scope": null,
  "department_scope": null,
  "data": {
    "interval": "day",
    "bucket_count": 365,
    "buckets": [
      {
        "start": "2025-09-01T00:00:00.000Z",
        "end": "2025-09-02T00:00:00.000Z",
        "applications_submitted": 2,
        "application_decisions": {
          "approved": 1,
          "auto_approved": 0,
          "rejected": 0,
          "total": 1
        },
        "inspections_completed": 0,
        "grievances_created": 0,
        "grievances_resolved": 0
      }
    ]
  }
}
```
*Note: Trends endpoints strictly enforce a 366-bucket cap calculation to prevent exhaustive memory scaling attacks.*

## Example Usages

**Curl for Trends (Admin Global):**
```bash
curl -H "Authorization: Bearer <ADMIN_TOKEN>" \
     "http://localhost:3000/api/admin/analytics/trends?startDate=2026-08-01T00:00:00Z&endDate=2026-09-01T00:00:00Z&interval=week"
```

**Curl for Bottlenecks (Officer Scoped):**
```bash
curl -H "Authorization: Bearer <OFFICER_TOKEN>" \
     "http://localhost:3000/api/admin/analytics/departments"
```

## Migration Guide
No frontend assumptions are made. Ensure to run migrations to pick up schema enhancements.
```bash
npm run migrate
```
