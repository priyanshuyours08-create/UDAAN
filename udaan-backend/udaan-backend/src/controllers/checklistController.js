const { Op } = require('sequelize');
const { ApplicantProfile, ApprovalRule } = require('../models');

/**
 * CORE DIFFERENTIATOR: Dynamic checklist generation.
 *
 * Instead of a hardcoded list per sector, this queries the ApprovalRule
 * table using the applicant's actual profile (sector, state, investment
 * amount, stage) and returns only the approvals that genuinely apply.
 *
 * Matching logic:
 *  - sector matches applicant's sector OR rule sector is 'all'
 *  - state matches applicant's state OR rule state is 'all'
 *  - stage matches applicant's stage OR rule stage is 'all'
 *  - applicant's investment_amount falls within [min_investment, max_investment]
 *
 * Add a new row to ApprovalRule (e.g. a new state's Pollution NOC rule) and
 * every matching applicant's checklist updates automatically — no code change.
 */
async function getChecklist(req, res) {
  try {
    const applicantId = req.params.applicantId;
    let profile;
    if (req.user.role === 'applicant') {
      profile = await ApplicantProfile.findOne({
        where: { id: applicantId, user_id: req.user.id },
      });
      if (!profile) {
        return res.status(403).json({ error: 'Applicant profile not found or access denied' });
      }
    } else {
      profile = await ApplicantProfile.findByPk(applicantId);
      if (!profile) return res.status(404).json({ error: 'Applicant profile not found' });
    }

    const rules = await ApprovalRule.findAll({
      where: {
        [Op.and]: [
          { [Op.or]: [{ sector: profile.sector }, { sector: 'all' }] },
          { [Op.or]: [{ state: profile.state }, { state: 'all' }] },
          { [Op.or]: [{ stage: profile.stage }, { stage: 'all' }] },
          { min_investment: { [Op.lte]: profile.investment_amount } },
          { max_investment: { [Op.gte]: profile.investment_amount } },
        ],
      },
      order: [['department', 'ASC']],
    });

    const checklist = rules.map((r) => ({
      approval_rule_id: r.id,
      approval_name: r.approval_name,
      department: r.department,
      required_documents: r.required_documents,
      sla_days: r.sla_days,
      hazard_level: r.hazard_level,
      requires_inspection: r.requires_inspection,
    }));

    res.json({
      applicant: {
        id: profile.id,
        business_name: profile.business_name,
        sector: profile.sector,
        state: profile.state,
        stage: profile.stage,
      },
      total_approvals_required: checklist.length,
      checklist,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getChecklist };
