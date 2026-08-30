const { Op } = require('sequelize');
const { sequelize, Application, ApprovalRule, Notification, User } = require('../models');
const { withSqliteWriteLock } = require('../utils/sqliteWriteLock');

function getWarningHours() {
  const raw = process.env.SLA_WARNING_HOURS;
  if (raw === undefined || raw === null || raw.trim() === '') return 48;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return 48;
  return num;
}

async function checkAndEscalate() {
  const results = {
    warnings_sent: 0,
    breaches_sent: 0,
    notifications_created: 0,
    skipped_no_recipients: 0,
    skipped_race: 0,
    skipped_invalid_rule_or_department: 0
  };

  const now = new Date();
  const warningHours = getWarningHours();
  const warningEnd = new Date(now.getTime() + warningHours * 60 * 60 * 1000);

  const eligibleStatuses = ['submitted', 'pending_review', 'pending_inspection'];

  // Cache admins
  const admins = await User.findAll({
    where: { role: 'admin' },
    attributes: ['id']
  });
  const adminIds = admins.map(a => a.id);

  // Helper
  const getDepartmentUsers = async (department) => {
    const users = await User.findAll({
      where: {
        role: { [Op.in]: ['officer', 'inspector'] },
        department
      },
      attributes: ['id']
    });
    return users.map(u => u.id);
  };

  // --- 1. Warnings ---
  const warnings = await Application.findAll({
    where: {
      status: { [Op.in]: eligibleStatuses },
      last_notified_level: 'none',
      sla_deadline: {
        [Op.gte]: now,
        [Op.lte]: warningEnd
      }
    },
    include: [{ model: ApprovalRule }]
  });

  for (const app of warnings) {
    if (!app.ApprovalRule || !app.ApprovalRule.department || app.ApprovalRule.department.trim() === '') {
      results.skipped_invalid_rule_or_department++;
      continue;
    }

    const deptUserIds = await getDepartmentUsers(app.ApprovalRule.department);
    const recipients = [...new Set(deptUserIds)];

    if (recipients.length === 0) {
      results.skipped_no_recipients++;
      continue;
    }

    await withSqliteWriteLock(sequelize, async () => {
      await sequelize.transaction(async (t) => {
        const [updatedCount] = await Application.update(
          { last_notified_level: 'warning' },
          {
            where: {
              id: app.id,
              last_notified_level: 'none',
              status: { [Op.in]: eligibleStatuses },
              sla_deadline: { [Op.gte]: now, [Op.lte]: warningEnd }
            },
            transaction: t
          }
        );

        if (updatedCount === 0) {
          results.skipped_race++;
          return;
        }

        const notifications = recipients.map(uid => ({
          user_id: uid,
          type: 'sla_warning',
          title: 'SLA Warning',
          message: `Application #${app.id} for ${app.ApprovalRule.approval_name} is approaching its SLA deadline.`,
          reference_type: 'application',
          reference_id: app.id
        }));

        await Notification.bulkCreate(notifications, { transaction: t });
        results.warnings_sent++;
        results.notifications_created += notifications.length;
      });
    });
  }

  // --- 2. Breaches ---
  const breaches = await Application.findAll({
    where: {
      status: { [Op.in]: eligibleStatuses },
      last_notified_level: { [Op.in]: ['none', 'warning'] },
      sla_deadline: {
        [Op.lt]: now
      }
    },
    include: [{ model: ApprovalRule }]
  });

  for (const app of breaches) {
    if (!app.ApprovalRule || !app.ApprovalRule.department || app.ApprovalRule.department.trim() === '') {
      results.skipped_invalid_rule_or_department++;
      continue;
    }

    const deptUserIds = await getDepartmentUsers(app.ApprovalRule.department);
    const recipients = [...new Set([...deptUserIds, ...adminIds])];

    if (recipients.length === 0) {
      results.skipped_no_recipients++;
      continue;
    }

    const initialLevel = app.last_notified_level;

    await withSqliteWriteLock(sequelize, async () => {
      await sequelize.transaction(async (t) => {
        const [updatedCount] = await Application.update(
          { last_notified_level: 'breach' },
          {
            where: {
              id: app.id,
              last_notified_level: initialLevel,
              status: { [Op.in]: eligibleStatuses },
              sla_deadline: { [Op.lt]: now }
            },
            transaction: t
          }
        );

        if (updatedCount === 0) {
          results.skipped_race++;
          return;
        }

        const notifications = recipients.map(uid => ({
          user_id: uid,
          type: 'sla_breach',
          title: 'SLA Breach',
          message: `Application #${app.id} for ${app.ApprovalRule.approval_name} has breached its SLA deadline.`,
          reference_type: 'application',
          reference_id: app.id
        }));

        await Notification.bulkCreate(notifications, { transaction: t });
        results.breaches_sent++;
        results.notifications_created += notifications.length;
      });
    });
  }

  return results;
}

module.exports = {
  checkAndEscalate
};
