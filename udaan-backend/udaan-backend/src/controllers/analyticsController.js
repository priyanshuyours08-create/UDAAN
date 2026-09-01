const { Op, Sequelize } = require('sequelize');
const { Application, ApprovalRule, Grievance, GrievanceEscalation, Inspection, InspectionApplication } = require('../models');

function parseDateValid(val) {
  if (Array.isArray(val)) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

async function getOverviewAnalytics(req, res) {
  try {
    let startDate, endDate;
    const now = new Date();

    const allowedQueries = ['department', 'startDate', 'endDate'];
    const providedQueries = Object.keys(req.query);
    for (const key of providedQueries) {
      if (!allowedQueries.includes(key)) {
        return res.status(400).json({ error: `Unknown query parameter: ${key}` });
      }
    }

    if (Array.isArray(req.query.startDate) || Array.isArray(req.query.endDate) || Array.isArray(req.query.department)) {
      return res.status(400).json({ error: 'Repeated query parameters are not allowed' });
    }

    if (!req.query.startDate && !req.query.endDate) {
      endDate = now;
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (req.query.startDate && req.query.endDate) {
      startDate = parseDateValid(req.query.startDate);
      endDate = parseDateValid(req.query.endDate);

      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'Invalid calendar timestamp for startDate or endDate' });
      }

      if (startDate >= endDate) {
        return res.status(400).json({ error: 'startDate must be before endDate' });
      }

      const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > 366) {
        return res.status(400).json({ error: 'Historical range cannot exceed 366 days' });
      }
    } else {
      return res.status(400).json({ error: 'Both startDate and endDate must be provided or both omitted' });
    }

    const { department } = req.analyticsScope;

    const baseInclude = [];
    if (department) {
      baseInclude.push({
        model: ApprovalRule,
        attributes: [],
        where: { department }
      });
    }

    const submittedInRangeOptions = {
      where: {
        submitted_at: {
          [Op.gte]: startDate,
          [Op.lt]: endDate
        }
      },
      include: baseInclude
    };

    const applications_submitted_in_range = await Application.count(submittedInRangeOptions);

    const statusCountsRaw = await Application.findAll({
      attributes: ['status', [Sequelize.fn('COUNT', Sequelize.col('Application.id')), 'count']],
      where: submittedInRangeOptions.where,
      include: baseInclude,
      group: ['Application.status'],
      raw: true
    });

    const application_statuses = {
      submitted: 0,
      pending_inspection: 0,
      inspection_scheduled: 0,
      pending_review: 0,
      approved: 0,
      rejected: 0,
      returned: 0,
      cancelled: 0
    };
    for (const row of statusCountsRaw) {
      if (application_statuses[row.status] !== undefined) {
        application_statuses[row.status] = parseInt(row.count, 10);
      }
    }

    const decidedInRangeOptions = {
      where: {
        status: { [Op.in]: ['approved', 'auto_approved', 'rejected'] },
        decided_at: {
          [Op.gte]: startDate,
          [Op.lt]: endDate
        }
      },
      include: baseInclude
    };

    const decisions_completed_in_range = await Application.count(decidedInRangeOptions);

    const decisionStatusCountsRaw = await Application.findAll({
      attributes: ['status', [Sequelize.fn('COUNT', Sequelize.col('Application.id')), 'count']],
      where: decidedInRangeOptions.where,
      include: baseInclude,
      group: ['Application.status'],
      raw: true
    });

    let approvedCount = 0;
    let autoApprovedCount = 0;
    let rejectedCount = 0;

    for (const row of decisionStatusCountsRaw) {
      const c = parseInt(row.count, 10);
      if (row.status === 'approved') approvedCount = c;
      if (row.status === 'auto_approved') autoApprovedCount = c;
      if (row.status === 'rejected') rejectedCount = c;
    }

    const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

    const approval_rate_for_decisions_in_range = {
      rate: decisions_completed_in_range > 0 ? round2(((approvedCount + autoApprovedCount) / decisions_completed_in_range) * 100) : 0.0,
      numerator: approvedCount + autoApprovedCount,
      denominator: decisions_completed_in_range
    };
    const rejection_rate_for_decisions_in_range = {
      rate: decisions_completed_in_range > 0 ? round2((rejectedCount / decisions_completed_in_range) * 100) : 0.0,
      numerator: rejectedCount,
      denominator: decisions_completed_in_range
    };
    const auto_approval_rate_for_decisions_in_range = {
      rate: decisions_completed_in_range > 0 ? round2((autoApprovedCount / decisions_completed_in_range) * 100) : 0.0,
      numerator: autoApprovedCount,
      denominator: decisions_completed_in_range
    };

    const decidedRecords = await Application.findAll({
      attributes: ['submitted_at', 'decided_at'],
      where: decidedInRangeOptions.where,
      include: baseInclude,
      raw: true
    });

    let totalTurnaroundMs = 0;
    let turnaroundSampleSize = 0;
    for (const row of decidedRecords) {
      const submitted = new Date(row.submitted_at);
      const decided = new Date(row.decided_at);
      if (!isNaN(submitted.getTime()) && !isNaN(decided.getTime())) {
        totalTurnaroundMs += (decided.getTime() - submitted.getTime());
        turnaroundSampleSize++;
      }
    }

    let average_hours = 0.0;
    if (turnaroundSampleSize > 0) {
      average_hours = round2(totalTurnaroundMs / (1000 * 60 * 60) / turnaroundSampleSize);
    }

    const average_turnaround_for_decisions_in_range = {
      average_hours,
      sample_size: turnaroundSampleSize
    };

    const pendingOptions = {
      where: {
        status: { [Op.in]: ['submitted', 'pending_review', 'pending_inspection'] }
      },
      include: baseInclude
    };
    const pending_workload = await Application.count(pendingOptions);

    res.json({
      success: true,
      generated_at: now.toISOString(),
      historical_range: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      },
      current_state_scope: "all_active_records",
      department_scope: department || null,
      data: {
        applications_submitted_in_range,
        decisions_completed_in_range,
        application_statuses,
        approval_rate_for_decisions_in_range,
        rejection_rate_for_decisions_in_range,
        auto_approval_rate_for_decisions_in_range,
        average_turnaround_for_decisions_in_range,
        pending_workload
      }
    });

  } catch (err) {
    console.error('[AnalyticsController] Unexpected error');
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getSlaAnalytics(req, res) {
  try {
    const allowedQueries = ['department'];
    const providedQueries = Object.keys(req.query);
    for (const key of providedQueries) {
      if (!allowedQueries.includes(key)) {
        return res.status(400).json({ error: `Unknown query parameter: ${key}` });
      }
    }
    if (Array.isArray(req.query.department)) {
      return res.status(400).json({ error: 'Repeated query parameters are not allowed' });
    }

    const { department } = req.analyticsScope;
    const now = new Date();

    let warningHours = Number(process.env.SLA_WARNING_HOURS);
    if (!Number.isFinite(warningHours) || warningHours <= 0) {
      warningHours = 48;
    }
    const warningEnd = new Date(now.getTime() + warningHours * 60 * 60 * 1000);

    const baseInclude = [];
    if (department) {
      baseInclude.push({
        model: ApprovalRule,
        attributes: [],
        where: { department }
      });
    }

    const pendingOptions = {
      attributes: ['sla_deadline', 'last_notified_level'],
      where: {
        status: { [Op.in]: ['submitted', 'pending_review', 'pending_inspection'] }
      },
      include: baseInclude,
      raw: true
    };

    const pendingRecords = await Application.findAll(pendingOptions);

    const sla_state = { breached: 0, warning: 0, on_track: 0, missing_deadline: 0 };
    const notification_levels_for_pending = { none: 0, warning: 0, breach: 0 };

    for (const record of pendingRecords) {
      if (record.last_notified_level === 'none') notification_levels_for_pending.none++;
      else if (record.last_notified_level === 'warning') notification_levels_for_pending.warning++;
      else if (record.last_notified_level === 'breach') notification_levels_for_pending.breach++;
      else notification_levels_for_pending.none++;

      if (!record.sla_deadline) {
        sla_state.missing_deadline++;
      } else {
        const deadline = new Date(record.sla_deadline);
        if (deadline < now) {
          sla_state.breached++;
        } else if (deadline >= now && deadline <= warningEnd) {
          sla_state.warning++;
        } else if (deadline > warningEnd) {
          sla_state.on_track++;
        }
      }
    }

    const pending_workload = sla_state.breached + sla_state.warning + sla_state.on_track + sla_state.missing_deadline;

    res.json({
      generated_at: now.toISOString(),
      historical_range: null,
      current_state_scope: "all_active_records",
      department_scope: department || null,
      data: {
        warning_hours: warningHours,
        pending_workload,
        sla_state,
        notification_levels_for_pending
      }
    });

  } catch (err) {
    console.error('[AnalyticsController SLA] Unexpected error');
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getDepartmentBottleneckAnalytics(req, res) {
  try {
    const allowedQueries = ['department'];
    const providedQueries = Object.keys(req.query);
    for (const key of providedQueries) {
      if (!allowedQueries.includes(key)) {
        return res.status(400).json({ error: `Unknown query parameter: ${key}` });
      }
    }
    if (Array.isArray(req.query.department)) {
      return res.status(400).json({ error: 'Repeated query parameters are not allowed' });
    }

    const { department } = req.analyticsScope;
    const now = new Date();

    const rules = await ApprovalRule.findAll({
      attributes: ['department'],
      group: ['department'],
      raw: true
    });

    const canonicalDepts = new Set();
    for (const rule of rules) {
      if (rule.department && rule.department.trim() !== '') {
        canonicalDepts.add(rule.department.trim());
      }
    }

    const rawDepts = rules.map(r => r.department);
    const validRawDepts = rawDepts.filter(d => d && d.trim() !== '');
    if (canonicalDepts.size !== validRawDepts.length) {
      console.error('[AnalyticsController Bottleneck] Defect: Duplicate canonical department values found after trimming.');
      return res.status(500).json({ error: 'Internal server error' });
    }

    const targetDepts = department ? [department] : Array.from(canonicalDepts);

    const pendingApps = await Application.findAll({
      attributes: ['id', 'status', 'submitted_at', 'sla_deadline'],
      where: {
        status: { [Op.in]: ['submitted', 'pending_review', 'pending_inspection'] }
      },
      include: [{
        model: ApprovalRule,
        attributes: ['department'],
        where: department ? { department } : {}
      }],
      raw: true
    });

    const highEscGrievances = await Grievance.findAll({
      attributes: ['id', 'department'],
      where: {
        status: { [Op.in]: ['open', 'in_progress', 'escalated'] },
        escalation_level: { [Op.in]: [2, 3] },
        department: department ? department : { [Op.in]: targetDepts }
      },
      raw: true
    });

    const metricsByDept = {};
    for (const dept of targetDepts) {
      metricsByDept[dept] = {
        pending_applications: 0,
        breached_pending_applications: 0,
        unresolved_high_escalation_grievances: 0,
        age_sum: 0,
        age_sample_size: 0
      };
    }

    for (const app of pendingApps) {
      const dept = app['ApprovalRule.department']?.trim();
      if (!dept || !metricsByDept[dept]) continue;

      metricsByDept[dept].pending_applications++;

      if (app.sla_deadline) {
        const deadline = new Date(app.sla_deadline);
        if (deadline < now) {
          metricsByDept[dept].breached_pending_applications++;
        }
      }

      if (app.submitted_at) {
        const submitted = new Date(app.submitted_at);
        if (!isNaN(submitted.getTime()) && submitted <= now) {
          metricsByDept[dept].age_sum += (now.getTime() - submitted.getTime());
          metricsByDept[dept].age_sample_size++;
        }
      }
    }

    for (const g of highEscGrievances) {
      const dept = g.department?.trim();
      if (!dept || !metricsByDept[dept]) continue;
      metricsByDept[dept].unresolved_high_escalation_grievances++;
    }

    const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

    let results = [];
    for (const dept of targetDepts) {
      const m = metricsByDept[dept];
      const bottleneck_score = m.pending_applications + (2 * m.breached_pending_applications) + (2 * m.unresolved_high_escalation_grievances);
      const rawAgeHours = m.age_sample_size > 0 ? (m.age_sum / (1000 * 60 * 60) / m.age_sample_size) : 0;
      const average_pending_age_hours = round2(rawAgeHours);

      results.push({
        department: dept,
        pending_applications: m.pending_applications,
        breached_pending_applications: m.breached_pending_applications,
        unresolved_high_escalation_grievances: m.unresolved_high_escalation_grievances,
        average_pending_age_hours,
        age_sample_size: m.age_sample_size,
        bottleneck_score,
        _rawAgeHours: rawAgeHours
      });
    }

    results.sort((a, b) => {
      if (b.bottleneck_score !== a.bottleneck_score) return b.bottleneck_score - a.bottleneck_score;
      if (b._rawAgeHours !== a._rawAgeHours) return b._rawAgeHours - a._rawAgeHours;
      if (b.breached_pending_applications !== a.breached_pending_applications) return b.breached_pending_applications - a.breached_pending_applications;
      return a.department.localeCompare(b.department);
    });

    results.forEach(r => delete r._rawAgeHours);

    res.json({
      generated_at: now.toISOString(),
      historical_range: null,
      current_state_scope: "all_active_records",
      department_scope: department || null,
      data: {
        formula: "pending_applications + (2 * breached_pending_applications) + (2 * unresolved_high_escalation_grievances)",
        departments: results
      }
    });

  } catch (err) {
    console.error('[AnalyticsController Bottleneck] Unexpected error');
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getInspectionAnalytics(req, res) {
  try {
    let startDate, endDate;
    const now = new Date();

    const allowedQueries = ['department', 'startDate', 'endDate'];
    const providedQueries = Object.keys(req.query);
    for (const key of providedQueries) {
      if (!allowedQueries.includes(key)) {
        return res.status(400).json({ error: `Unknown query parameter: ${key}` });
      }
    }

    if (Array.isArray(req.query.startDate) || Array.isArray(req.query.endDate) || Array.isArray(req.query.department)) {
      return res.status(400).json({ error: 'Repeated query parameters are not allowed' });
    }

    if (!req.query.startDate && !req.query.endDate) {
      endDate = now;
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (req.query.startDate && req.query.endDate) {
      startDate = parseDateValid(req.query.startDate);
      endDate = parseDateValid(req.query.endDate);

      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'Invalid calendar timestamp for startDate or endDate' });
      }

      if (startDate >= endDate) {
        return res.status(400).json({ error: 'startDate must be before endDate' });
      }

      const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > 366) {
        return res.status(400).json({ error: 'Historical range cannot exceed 366 days' });
      }
    } else {
      return res.status(400).json({ error: 'Both startDate and endDate must be provided if either is supplied' });
    }

    const { department } = req.analyticsScope;

    const completedInspections = await Inspection.findAll({
      where: {
        status: 'completed',
        completed_at: {
          [Op.gte]: startDate,
          [Op.lt]: endDate
        }
      },
      include: department ? [{
        model: Application,
        required: true,
        include: [{
          model: ApprovalRule,
          required: true,
          where: { department }
        }]
      }] : [],
      attributes: ['id', 'createdAt', 'completed_at', 'result']
    });

    const uniqueInspections = new Map();
    for (const insp of completedInspections) {
      uniqueInspections.set(insp.id, insp);
    }

    let totalDurationMs = 0;
    let completed_sample_size = 0;
    const resultsCohort = { pass: 0, fail: 0, conditional: 0 };

    for (const insp of uniqueInspections.values()) {
      if (insp.result && resultsCohort[insp.result] !== undefined) {
         resultsCohort[insp.result]++;
      }
      const created = new Date(insp.createdAt);
      const completed = new Date(insp.completed_at);
      if (!isNaN(created.getTime()) && !isNaN(completed.getTime())) {
        totalDurationMs += (completed.getTime() - created.getTime());
        completed_sample_size++;
      }
    }

    const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;
    let average_completion_hours = 0.0;
    if (completed_sample_size > 0) {
      average_completion_hours = round2(totalDurationMs / (1000 * 60 * 60) / completed_sample_size);
    }

    const unassignedWhere = { status: 'scheduled', assigned_inspector_id: null };
    const unassignedInspections = await Inspection.count({
      distinct: true,
      where: unassignedWhere,
      include: department ? [{
        model: Application,
        required: true,
        include: [{
          model: ApprovalRule,
          required: true,
          where: { department }
        }]
      }] : []
    });

    res.json({
      success: true,
      generated_at: now.toISOString(),
      historical_range: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      },
      current_state_scope: "all_active_records",
      department_scope: department || null,
      data: {
        completed_inspections_in_range: uniqueInspections.size,
        inspection_results: resultsCohort,
        average_inspection_duration: {
          avg_hours: average_completion_hours,
          sample_size: completed_sample_size
        },
        unassigned_scheduled_inspections: unassignedInspections
      }
    });

  } catch (err) {
    console.error('[AnalyticsController Inspection] Unexpected error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getGrievanceAnalytics(req, res) {
  try {
    let startDate, endDate;
    const now = new Date();

    const allowedQueries = ['department', 'startDate', 'endDate'];
    const providedQueries = Object.keys(req.query);
    for (const key of providedQueries) {
      if (!allowedQueries.includes(key)) {
        return res.status(400).json({ error: `Unknown query parameter: ${key}` });
      }
    }

    if (Array.isArray(req.query.startDate) || Array.isArray(req.query.endDate) || Array.isArray(req.query.department)) {
      return res.status(400).json({ error: 'Repeated query parameters are not allowed' });
    }

    if (!req.query.startDate && !req.query.endDate) {
      endDate = now;
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (req.query.startDate && req.query.endDate) {
      startDate = parseDateValid(req.query.startDate);
      endDate = parseDateValid(req.query.endDate);

      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'Invalid calendar timestamp for startDate or endDate' });
      }

      if (startDate >= endDate) {
        return res.status(400).json({ error: 'startDate must be before endDate' });
      }

      const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > 366) {
        return res.status(400).json({ error: 'Historical range cannot exceed 366 days' });
      }
    } else {
      return res.status(400).json({ error: 'Both startDate and endDate must be provided if either is supplied' });
    }

    const { department } = req.analyticsScope;

    const whereClauseRange = {
      createdAt: {
        [Op.gte]: startDate,
        [Op.lt]: endDate
      }
    };
    if (department) {
      whereClauseRange.department = department;
    }

    const filedGrievances = await Grievance.findAll({
      where: whereClauseRange,
      attributes: ['status']
    });

    let grievances_filed_in_range = filedGrievances.length;
    const grievance_statuses_for_created_cohort = { open: 0, in_progress: 0, escalated: 0, resolved: 0, closed: 0 };
    for (const g of filedGrievances) {
       if (grievance_statuses_for_created_cohort[g.status] !== undefined) {
          grievance_statuses_for_created_cohort[g.status]++;
       }
    }

    const whereClauseUnresolved = {
      status: { [Op.in]: ['open', 'in_progress', 'escalated'] }
    };
    if (department) {
      whereClauseUnresolved.department = department;
    }

    const unresolvedGrievances = await Grievance.findAll({
      where: whereClauseUnresolved,
      attributes: ['escalation_level']
    });

    const unresolved_escalation_levels = { "0": 0, "1": 0, "2": 0, "3": 0 };
    for (const g of unresolvedGrievances) {
       if (unresolved_escalation_levels[String(g.escalation_level)] !== undefined) {
          unresolved_escalation_levels[String(g.escalation_level)]++;
       }
    }

    const resolvedWhere = {
      status: { [Op.in]: ['resolved', 'closed'] },
      resolved_at: {
        [Op.gte]: startDate,
        [Op.lt]: endDate
      }
    };
    if (department) {
      resolvedWhere.department = department;
    }

    const resolvedGrievancesList = await Grievance.findAll({
      where: resolvedWhere,
      attributes: ['createdAt', 'resolved_at']
    });

    let totalDurationMs = 0;
    let resolved_sample_size = 0;

    for (const g of resolvedGrievancesList) {
      const created = new Date(g.createdAt);
      const resolved = new Date(g.resolved_at);
      if (!isNaN(created.getTime()) && !isNaN(resolved.getTime())) {
        totalDurationMs += (resolved.getTime() - created.getTime());
        resolved_sample_size++;
      }
    }

    const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;
    let average_resolution_hours = 0.0;
    if (resolved_sample_size > 0) {
      average_resolution_hours = round2(totalDurationMs / (1000 * 60 * 60) / resolved_sample_size);
    }

    res.json({
      success: true,
      generated_at: now.toISOString(),
      historical_range: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      },
      current_state_scope: "all_active_records",
      department_scope: department || null,
      data: {
        grievances_created_in_range: grievances_filed_in_range,
        grievance_statuses: grievance_statuses_for_created_cohort,
        grievances_resolved_in_range: resolvedGrievancesList.length,
        average_grievance_resolution_time: {
          avg_hours: average_resolution_hours,
          sample_size: resolved_sample_size
        },
        unresolved_grievances: unresolvedGrievances.length,
        unresolved_grievance_levels: unresolved_escalation_levels
      }
    });

  } catch (err) {
    console.error('[AnalyticsController Grievance] Unexpected error');
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { getOverviewAnalytics, getSlaAnalytics, getDepartmentBottleneckAnalytics, getInspectionAnalytics, getGrievanceAnalytics };
