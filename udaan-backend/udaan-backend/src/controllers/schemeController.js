const { Op } = require('sequelize');
const { ApplicantProfile, Scheme } = require('../models');

// Proactive scheme matching: same pattern as the checklist engine, but
// against the Scheme table. Surfaces incentives the applicant may not
// know exist, instead of leaving discovery entirely up to them.
async function matchSchemes(req, res) {
  try {
    const profile = await ApplicantProfile.findByPk(req.params.applicantId);
    if (!profile) return res.status(404).json({ error: 'Applicant profile not found' });

    const schemes = await Scheme.findAll({
      where: {
        [Op.and]: [
          { [Op.or]: [{ sector: profile.sector }, { sector: 'all' }] },
          { [Op.or]: [{ state: profile.state }, { state: 'all' }] },
          { min_investment: { [Op.lte]: profile.investment_amount } },
          { max_investment: { [Op.gte]: profile.investment_amount } },
          { min_employees: { [Op.lte]: profile.employee_count } },
        ],
      },
    });

    res.json({ eligible_scheme_count: schemes.length, schemes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { matchSchemes };
