const { Application, ApprovalRule } = require('../models');
const { sequelize } = require('../models');

// Powers the bottleneck/delay analytics dashboard for admins.
async function getAnalytics(req, res) {
  try {
    const totalApplications = await Application.count();

    const statusCounts = await Application.findAll({
      attributes: ['status', [sequelize.fn('COUNT', sequelize.col('status')), 'count']],
      group: ['status'],
    });

    const now = new Date();
    const allApplications = await Application.findAll({ include: [{ model: ApprovalRule }] });

    const atRiskOfSlaBreach = allApplications.filter((a) => {
      const daysLeft = Math.ceil((new Date(a.sla_deadline) - now) / (1000 * 60 * 60 * 24));
      return daysLeft <= 2 && daysLeft >= 0 && !['approved', 'auto_approved', 'rejected'].includes(a.status);
    });

    const alreadyBreached = allApplications.filter((a) => {
      const daysLeft = Math.ceil((new Date(a.sla_deadline) - now) / (1000 * 60 * 60 * 24));
      return daysLeft < 0 && !['approved', 'auto_approved', 'rejected'].includes(a.status);
    });

    // Bottleneck view: which departments have the most pending applications
    const byDepartment = {};
    for (const a of allApplications) {
      const dept = a.ApprovalRule.department;
      if (!byDepartment[dept]) byDepartment[dept] = { total: 0, pending: 0 };
      byDepartment[dept].total += 1;
      if (!['approved', 'auto_approved', 'rejected'].includes(a.status)) {
        byDepartment[dept].pending += 1;
      }
    }

    res.json({
      total_applications: totalApplications,
      status_breakdown: statusCounts,
      applications_at_risk_of_sla_breach: atRiskOfSlaBreach.length,
      applications_already_breached: alreadyBreached.length,
      bottlenecks_by_department: byDepartment,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

const complianceOrchestrator = require('../services/complianceOrchestrator');

async function runSlaCheck(req, res) {
  try {
    const results = await complianceOrchestrator.runComplianceChecks();
    if (!results.success && !results.partial_failure) {
      return res.status(500).json(results);
    }
    res.json(results);
  } catch (err) {
    console.error('[AdminController] Orchestrator unexpected rejection:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { getAnalytics, runSlaCheck };
