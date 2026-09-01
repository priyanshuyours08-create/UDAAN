const { Op, Sequelize } = require('sequelize');
const { Application, ApprovalRule } = require('../models');

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
    console.error('[AnalyticsController] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { getOverviewAnalytics };
