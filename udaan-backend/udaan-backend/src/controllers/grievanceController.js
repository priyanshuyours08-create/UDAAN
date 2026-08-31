const { Grievance, ApplicantProfile, Application, ApprovalRule, sequelize } = require('../models');
const { withSqliteWriteLock } = require('../utils/sqliteWriteLock');

async function createGrievance(req, res) {
  try {
    if (req.user.role !== 'applicant') {
      return res.status(403).json({ error: 'Only applicants can create grievances' });
    }

    const privilegedFields = [
      'applicant_id', 'department', 'assigned_to', 'classified_by',
      'classified_at', 'status', 'escalation_level', 'sla_deadline', 'next_escalation_at',
      'state_version', 'resolved_at', 'resolution_notes'
    ];
    
    for (const field of privilegedFields) {
      if (req.body[field] !== undefined) {
        return res.status(400).json({ error: `Field '${field}' is privileged and cannot be set directly` });
      }
    }

    let { subject, description, priority, application_id } = req.body;

    if (typeof subject !== 'string' || subject.trim().length === 0 || subject.trim().length > 200) {
      return res.status(400).json({ error: 'subject must be a string between 1 and 200 characters' });
    }
    subject = subject.trim();

    if (typeof description !== 'string' || description.trim().length === 0 || description.trim().length > 2000) {
      return res.status(400).json({ error: 'description must be a string between 1 and 2000 characters' });
    }
    description = description.trim();

    if (priority && !['low', 'medium', 'high'].includes(priority)) {
      return res.status(400).json({ error: 'priority must be low, medium, or high' });
    }

    if (application_id !== undefined && application_id !== null) {
      if (!Number.isInteger(application_id) || application_id <= 0) {
        return res.status(400).json({ error: 'application_id must be a positive integer' });
      }
    } else {
      application_id = null;
    }

    const profile = await ApplicantProfile.findOne({
      where: { user_id: req.user.id }
    });

    if (!profile) {
      return res.status(403).json({ error: 'Applicant profile not found or access denied' });
    }

    let derivedDepartment = null;

    if (application_id) {
      const app = await Application.findByPk(application_id, {
        include: [{ model: ApprovalRule }]
      });
      if (!app) {
        return res.status(404).json({ error: 'Application not found' });
      }
      if (app.applicant_id !== profile.id) {
        return res.status(403).json({ error: 'Cannot link a grievance to an application you do not own' });
      }
      if (!app.ApprovalRule) {
        return res.status(409).json({ error: 'Approval rule missing for application' });
      }
      if (!app.ApprovalRule.department || app.ApprovalRule.department.trim() === '') {
        return res.status(409).json({ error: 'Approval rule department is null or empty' });
      }
      derivedDepartment = app.ApprovalRule.department;
    }

    let createdGrievance = null;

    await withSqliteWriteLock(sequelize, async () => {
      await sequelize.transaction(async (t) => {
        const now = new Date();
        const deadline = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        createdGrievance = await Grievance.create({
          applicant_id: profile.id,
          application_id: application_id,
          subject: subject,
          description: description,
          priority: priority || 'medium',
          department: derivedDepartment,
          sla_deadline: deadline,
          next_escalation_at: deadline,
          assigned_to: null,
          classified_by: null,
          classified_at: null,
          status: 'open',
          escalation_level: 0,
          state_version: 0,
          resolved_at: null,
          resolution_notes: null
        }, { transaction: t });
      });
    });

    res.status(201).json(createdGrievance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getMyGrievances(req, res) {
  try {
    if (req.user.role !== 'applicant') {
      return res.status(403).json({ error: 'Only applicants can view their grievances' });
    }

    const profile = await ApplicantProfile.findOne({
      where: { user_id: req.user.id }
    });

    if (!profile) {
      return res.status(403).json({ error: 'Applicant profile not found or access denied' });
    }

    let { page = 1, limit = 20 } = req.query;
    page = Number(page);
    limit = Number(limit);

    if (!Number.isInteger(page) || page <= 0) {
      return res.status(400).json({ error: 'page must be a positive integer' });
    }
    if (!Number.isInteger(limit) || limit <= 0) {
      return res.status(400).json({ error: 'limit must be a positive integer' });
    }
    if (limit > 100) limit = 100;

    const offset = (page - 1) * limit;

    const { count, rows } = await Grievance.findAndCountAll({
      where: { applicant_id: profile.id },
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit: limit,
      offset: offset
    });

    res.json({
      grievances: rows,
      pagination: {
        page: page,
        limit: limit,
        total: count,
        total_pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  createGrievance,
  getMyGrievances
};
