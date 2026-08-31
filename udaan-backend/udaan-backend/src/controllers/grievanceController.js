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

async function classifyGrievance(req, res) {
  try {
    const { id } = req.params;
    if (!/^[1-9]\d*$/.test(id)) return res.status(400).json({ error: 'Invalid grievance ID' });

    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can classify grievances' });

    const allowedKeys = ['department', 'state_version'];
    for (const key of Object.keys(req.body)) {
      if (!allowedKeys.includes(key)) return res.status(400).json({ error: `Field '${key}' not allowed` });
    }

    const { department, state_version } = req.body;

    if (!Number.isInteger(state_version) || state_version < 0) {
      return res.status(400).json({ error: 'state_version must be a non-negative integer' });
    }

    if (typeof department !== 'string' || department.trim() === '') {
      return res.status(400).json({ error: 'department must be a non-empty string' });
    }
    const trimmedDept = department.trim();

    let earlyResponse = null;

    await withSqliteWriteLock(sequelize, async () => {
      await sequelize.transaction(async (t) => {
        const grievance = await Grievance.findByPk(id, { transaction: t });
        if (!grievance) {
          earlyResponse = { status: 404, body: { error: 'Grievance not found' } };
          return;
        }

        if (grievance.application_id !== null) {
          earlyResponse = { status: 409, body: { error: 'Cannot classify a linked grievance' } };
          return;
        }

        if (grievance.department === trimmedDept) {
          earlyResponse = { status: 409, body: { error: 'Grievance already assigned to this department' } };
          return;
        }

        const canonicalRule = await ApprovalRule.findOne({
          where: { department: trimmedDept },
          transaction: t
        });

        if (!canonicalRule) {
          earlyResponse = { status: 400, body: { error: 'Unknown department' } };
          return;
        }

        const [affectedRows] = await Grievance.update({
          department: canonicalRule.department,
          classified_by: req.user.id,
          classified_at: new Date(),
          state_version: grievance.state_version + 1,
          assigned_to: grievance.assigned_to && grievance.Assignee?.department !== canonicalRule.department ? null : grievance.assigned_to
        }, {
          where: {
            id: grievance.id,
            state_version: state_version,
            department: grievance.department
          },
          transaction: t
        });

        if (affectedRows === 0) {
          earlyResponse = { status: 409, body: { error: 'State conflict' } };
          return;
        }

        earlyResponse = { status: 200, body: { message: 'Classified successfully' } };
      });
    });

    res.status(earlyResponse.status).json(earlyResponse.body);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function claimGrievance(req, res) {
  try {
    const { id } = req.params;
    if (!/^[1-9]\d*$/.test(id)) return res.status(400).json({ error: 'Invalid grievance ID' });

    const role = req.user.role;
    if (role !== 'officer' && role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const allowedKeys = role === 'admin' ? ['assignee_id', 'state_version'] : ['state_version'];
    for (const key of Object.keys(req.body)) {
      if (!allowedKeys.includes(key)) return res.status(400).json({ error: `Field '${key}' not allowed` });
    }

    const { assignee_id, state_version } = req.body;

    if (!Number.isInteger(state_version) || state_version < 0) {
      return res.status(400).json({ error: 'state_version must be a non-negative integer' });
    }

    let targetAssigneeId = null;
    if (role === 'officer') {
      targetAssigneeId = req.user.id;
    } else if (role === 'admin') {
      if (assignee_id !== null && (!Number.isInteger(assignee_id) || assignee_id <= 0)) {
        return res.status(400).json({ error: 'assignee_id must be a positive integer or null' });
      }
      targetAssigneeId = assignee_id;
    }

    let earlyResponse = null;

    await withSqliteWriteLock(sequelize, async () => {
      await sequelize.transaction(async (t) => {
        const grievance = await Grievance.findByPk(id, { transaction: t });
        if (!grievance) {
          earlyResponse = { status: 404, body: { error: 'Grievance not found' } };
          return;
        }

        if (grievance.status === 'resolved' || grievance.status === 'closed') {
          earlyResponse = { status: 409, body: { error: 'Grievance is resolved or closed' } };
          return;
        }

        if (role === 'officer') {
          if (!req.user.department || req.user.department === '') {
            earlyResponse = { status: 403, body: { error: 'Officer has no department' } };
            return;
          }
          if (grievance.department !== req.user.department) {
            earlyResponse = { status: 403, body: { error: 'Cross-department claim not allowed' } };
            return;
          }
          if (grievance.escalation_level >= 2) {
            earlyResponse = { status: 403, body: { error: 'Officer cannot claim level 2 or 3 grievance' } };
            return;
          }
          if (grievance.assigned_to !== null) {
            earlyResponse = { status: 409, body: { error: 'Grievance already assigned' } };
            return;
          }
        } else if (role === 'admin') {
          if (targetAssigneeId !== null && (!grievance.department || grievance.department === '')) {
            earlyResponse = { status: 409, body: { error: 'Grievance must have a department before assignment' } };
            return;
          }
        }

        if (targetAssigneeId === grievance.assigned_to) {
          earlyResponse = { status: 409, body: { error: 'Already assigned to this user' } };
          return;
        }

        if (targetAssigneeId !== null) {
          const { User } = require('../models');
          const targetUser = await User.findByPk(targetAssigneeId, { transaction: t });
          if (!targetUser) {
            earlyResponse = { status: 404, body: { error: 'Target user not found' } };
            return;
          }
          if (targetUser.role !== 'officer') {
            earlyResponse = { status: 400, body: { error: 'Target user is not an officer' } };
            return;
          }
          if (targetUser.department !== grievance.department) {
            earlyResponse = { status: 409, body: { error: 'Officer department mismatch' } };
            return;
          }
        }

        const [affectedRows] = await Grievance.update({
          assigned_to: targetAssigneeId,
          state_version: grievance.state_version + 1
        }, {
          where: {
            id: grievance.id,
            state_version: state_version,
            assigned_to: grievance.assigned_to
          },
          transaction: t
        });

        if (affectedRows === 0) {
          earlyResponse = { status: 409, body: { error: 'State conflict' } };
          return;
        }

        earlyResponse = { status: 200, body: { message: 'Claim successful' } };
      });
    });

    res.status(earlyResponse.status).json(earlyResponse.body);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getAssignedGrievances(req, res) {
  try {
    const role = req.user.role;
    if (role !== 'officer' && role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    let { page = 1, limit = 20, status, department, assigned, escalation_level } = req.query;
    page = Number(page);
    limit = Number(limit);

    if (!Number.isInteger(page) || page <= 0) return res.status(400).json({ error: 'page must be positive' });
    if (!Number.isInteger(limit) || limit <= 0) return res.status(400).json({ error: 'limit must be positive' });
    if (limit > 100) limit = 100;

    const where = {};
    const { Op } = require('sequelize');

    if (role === 'officer') {
      if (!req.user.department || req.user.department.trim() === '') {
        return res.status(403).json({ error: 'Officer has no department' });
      }

      where[Op.or] = [
        { assigned_to: req.user.id },
        {
          assigned_to: null,
          department: req.user.department,
          escalation_level: { [Op.lt]: 2 },
          status: { [Op.notIn]: ['resolved', 'closed'] }
        }
      ];
    } else {
      if (status) {
        if (!['open', 'in_progress', 'escalated', 'resolved', 'closed'].includes(status)) {
          return res.status(400).json({ error: 'Invalid status filter' });
        }
        where.status = status;
      }
      if (department) {
        where.department = department;
      }
      if (assigned !== undefined) {
        if (assigned === 'true') where.assigned_to = { [Op.ne]: null };
        else if (assigned === 'false') where.assigned_to = null;
        else return res.status(400).json({ error: 'Invalid assigned filter' });
      }
      if (escalation_level !== undefined) {
        const lv = Number(escalation_level);
        if (![0, 1, 2, 3].includes(lv)) return res.status(400).json({ error: 'Invalid escalation_level filter' });
        where.escalation_level = lv;
      }
    }

    const offset = (page - 1) * limit;

    const { count, rows } = await Grievance.findAndCountAll({
      where,
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit,
      offset
    });

    res.json({
      grievances: rows,
      pagination: {
        page, limit, total: count, total_pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function updateGrievanceStatus(req, res) {
  try {
    const { id } = req.params;
    if (!/^[1-9]\d*$/.test(id)) return res.status(400).json({ error: 'Invalid grievance ID' });

    const role = req.user.role;
    if (!['applicant', 'officer', 'admin'].includes(role)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const allowedKeys = ['status', 'resolution_notes', 'state_version'];
    for (const key of Object.keys(req.body)) {
      if (!allowedKeys.includes(key)) return res.status(400).json({ error: `Field '${key}' not allowed` });
    }

    const { status, resolution_notes, state_version } = req.body;

    if (!Number.isInteger(state_version) || state_version < 0) {
      return res.status(400).json({ error: 'state_version must be a non-negative integer' });
    }

    if (!status || !['open', 'in_progress', 'escalated', 'resolved', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid or missing status' });
    }

    let earlyResponse = null;

    await withSqliteWriteLock(sequelize, async () => {
      await sequelize.transaction(async (t) => {
        const grievance = await Grievance.findByPk(id, { transaction: t });
        if (!grievance) {
          earlyResponse = { status: 404, body: { error: 'Grievance not found' } };
          return;
        }

        if (grievance.status === status) {
          earlyResponse = { status: 409, body: { error: 'Status is already set to this value' } };
          return;
        }

        if (role === 'applicant') {
          const profile = await ApplicantProfile.findOne({ where: { user_id: req.user.id }, transaction: t });
          if (!profile || grievance.applicant_id !== profile.id) {
            earlyResponse = { status: 403, body: { error: 'Grievance does not belong to you' } };
            return;
          }
          if (status !== 'closed') {
            earlyResponse = { status: 403, body: { error: 'Applicant can only transition to closed' } };
            return;
          }
          if (grievance.status !== 'resolved') {
            earlyResponse = { status: 409, body: { error: 'State conflict' } };
            return;
          }
          if (resolution_notes !== undefined) {
            earlyResponse = { status: 400, body: { error: 'Applicant cannot set resolution_notes' } };
            return;
          }
        } else {
          if (status === 'closed') {
            earlyResponse = { status: 403, body: { error: 'Staff cannot close a grievance' } };
            return;
          }
          const validTransitions = {
            'open': ['in_progress', 'resolved'],
            'in_progress': ['resolved'],
            'escalated': ['in_progress', 'resolved']
          };
          if (!validTransitions[grievance.status] || !validTransitions[grievance.status].includes(status)) {
            earlyResponse = { status: 409, body: { error: 'Invalid state transition' } };
            return;
          }

          if (role === 'officer') {
            if (grievance.assigned_to !== req.user.id) {
              earlyResponse = { status: 403, body: { error: 'Not assigned to you' } };
              return;
            }
            if (!grievance.department || grievance.department === '') {
              earlyResponse = { status: 403, body: { error: 'Grievance has no department' } };
              return;
            }
            if (grievance.department !== req.user.department) {
              earlyResponse = { status: 403, body: { error: 'Cross-department update not allowed' } };
              return;
            }
          }

          if (status === 'resolved') {
            if (typeof resolution_notes !== 'string' || resolution_notes.trim().length === 0 || resolution_notes.trim().length > 2000) {
              earlyResponse = { status: 400, body: { error: 'resolution_notes must be a string between 1 and 2000 characters' } };
              return;
            }
          }
        }

        const updateData = {
          status,
          state_version: grievance.state_version + 1
        };

        if (status === 'resolved') {
          updateData.resolved_at = new Date();
          updateData.resolution_notes = resolution_notes.trim();
          updateData.next_escalation_at = null;
        }

        const [affectedRows] = await Grievance.update(updateData, {
          where: {
            id: grievance.id,
            state_version: state_version,
            status: grievance.status
          },
          transaction: t
        });

        if (affectedRows === 0) {
          earlyResponse = { status: 409, body: { error: 'State conflict' } };
          return;
        }

        earlyResponse = { status: 200, body: { message: 'Status updated successfully' } };
      });
    });

    res.status(earlyResponse.status).json(earlyResponse.body);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  createGrievance,
  getMyGrievances,
  classifyGrievance,
  claimGrievance,
  getAssignedGrievances,
  updateGrievanceStatus
};
