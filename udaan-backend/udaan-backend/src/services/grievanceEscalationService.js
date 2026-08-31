const { Grievance, GrievanceEscalation, ApplicantProfile, User, Notification, sequelize } = require('../models');
const { Op } = require('sequelize');
const { withSqliteWriteLock } = require('../utils/sqliteWriteLock');

async function checkGrievanceEscalations(options = {}) {
  const now = options.now || new Date();
  
  let escalationHours = Number(process.env.GRIEVANCE_ESCALATION_HOURS);
  if (!Number.isFinite(escalationHours) || escalationHours <= 0) {
    escalationHours = 48;
  }

  let escalations_processed = 0;
  let notifications_created = 0;
  let skipped_race = 0;
  let skipped_no_recipient = 0;
  let skipped_ineligible = 0;

  const candidates = await Grievance.findAll({
    where: {
      status: { [Op.in]: ['open', 'in_progress', 'escalated'] },
      escalation_level: { [Op.lt]: 3 },
      next_escalation_at: {
        [Op.not]: null,
        [Op.lte]: now
      }
    }
  });

  for (const grievance of candidates) {
    const profile = await ApplicantProfile.findByPk(grievance.applicant_id, {
      include: [{ model: User }]
    });

    if (!profile || !profile.User) {
      skipped_no_recipient++;
      continue;
    }

    await withSqliteWriteLock(sequelize, async () => {
      await sequelize.transaction(async (t) => {
        const currentGrievance = await Grievance.findByPk(grievance.id, { transaction: t });
        
        if (!currentGrievance || 
            !['open', 'in_progress', 'escalated'].includes(currentGrievance.status) || 
            currentGrievance.escalation_level >= 3 || 
            !currentGrievance.next_escalation_at || 
            currentGrievance.next_escalation_at > now) {
          skipped_ineligible++;
          return;
        }

        const from_level = currentGrievance.escalation_level;
        const to_level = from_level + 1;
        let next_escalation_at = currentGrievance.next_escalation_at;
        
        if (to_level < 3) {
          next_escalation_at = new Date(now.getTime() + escalationHours * 60 * 60 * 1000);
        } else {
          next_escalation_at = null;
        }

        const assigned_to = to_level >= 2 ? null : currentGrievance.assigned_to;

        const [affectedRows] = await Grievance.update({
          status: 'escalated',
          escalation_level: to_level,
          state_version: currentGrievance.state_version + 1,
          next_escalation_at,
          assigned_to
        }, {
          where: {
            id: currentGrievance.id,
            state_version: currentGrievance.state_version,
            escalation_level: from_level,
            status: currentGrievance.status,
            next_escalation_at: currentGrievance.next_escalation_at
          },
          transaction: t
        });

        if (affectedRows === 0) {
          skipped_race++;
          return;
        }

        await GrievanceEscalation.create({
          grievance_id: currentGrievance.id,
          from_level,
          to_level,
          escalation_type: 'automatic',
          escalated_by: null,
          reason: 'Automatic SLA escalation due to elapsed deadline.',
          idempotency_key: null,
          request_fingerprint: null
        }, { transaction: t });

        await Notification.create({
          user_id: profile.User.id,
          type: 'grievance_update',
          title: `Grievance Escalated to Level ${to_level}`,
          message: `Your grievance has been automatically escalated to level ${to_level} due to the elapsed deadline.`,
          reference_type: 'grievance',
          reference_id: currentGrievance.id,
          is_read: false
        }, { transaction: t });

        escalations_processed++;
        notifications_created++;
      });
    });
  }

  return {
    escalations_processed,
    notifications_created,
    skipped_race,
    skipped_no_recipient,
    skipped_ineligible
  };
}

module.exports = {
  checkGrievanceEscalations
};
