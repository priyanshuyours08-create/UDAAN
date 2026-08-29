const { ApplicantProfile } = require('../models');

async function createProfile(req, res) {
  try {
    const {
      business_name,
      sector,
      nic_code,
      state,
      district,
      investment_amount,
      employee_count,
      stage,
    } = req.body;

    if (!business_name || !sector || !state || investment_amount == null || employee_count == null) {
      return res.status(400).json({
        error: 'business_name, sector, state, investment_amount and employee_count are required',
      });
    }

    const profile = await ApplicantProfile.create({
      user_id: req.user.id,
      business_name,
      sector,
      nic_code,
      state,
      district,
      investment_amount,
      employee_count,
      stage: stage || 'pre_establishment',
    });

    res.status(201).json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getMyProfile(req, res) {
  try {
    const profile = await ApplicantProfile.findOne({ where: { user_id: req.user.id } });
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { createProfile, getMyProfile };
