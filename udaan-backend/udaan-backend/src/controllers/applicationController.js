const { Op } = require('sequelize');
const { sequelize, ApplicantProfile, ApprovalRule, Application, DocumentVault } = require('../models');
const { computeRiskLevel, routeByRisk } = require('./riskEngine');

// Single-instance per-applicant mutex queue to prevent race conditions during parallel submissions.
// NOTE: For multi-instance production deployments, replace this in-memory Map with Redis (redlock)
// or DB-level row locks (FOR UPDATE) combined with unique constraints on (applicant_id, approval_rule_id).
const submitLocks = new Map();

async function acquireApplicantLock(applicantId) {
  let previousPromise = submitLocks.get(applicantId) || Promise.resolve();
  let release;
  const currentPromise = new Promise((resolve) => {
    release = resolve;
  });
  submitLocks.set(applicantId, previousPromise.then(() => currentPromise));

  await previousPromise;

  return () => {
    release();
    if (submitLocks.get(applicantId) === currentPromise) {
      submitLocks.delete(applicantId);
    }
  };
}

/**
 * Submits an application: generates the checklist (same logic as
 * checklistController), then creates ONE Application row per required
 * approval, auto-attaches documents already in the vault, scores risk,
 * and routes each one — all approvals proceed in parallel from here.
 */
async function submitApplication(req, res) {
  let releaseLock;
  try {
    const { applicant_id } = req.body;
    const allowResubmission = req.body.allow_resubmission === true || req.body.allow_resubmission === 'true';

    if (!applicant_id) {
      return res.status(400).json({ error: 'applicant_id is required' });
    }

    releaseLock = await acquireApplicantLock(applicant_id);

    let profile;
    if (req.user.role === 'applicant') {
      profile = await ApplicantProfile.findOne({
        where: { id: applicant_id, user_id: req.user.id },
      });
      if (!profile) {
        return res.status(403).json({ error: 'Applicant profile not found or access denied' });
      }
    } else {
      profile = await ApplicantProfile.findByPk(applicant_id);
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
    });

    if (rules.length === 0) {
      return res.status(400).json({ error: 'No matching approval rules found for this profile' });
    }

    // Only count the latest uploaded document per document_type if verified and non-expired
    const now = new Date();
    const allVaultDocs = await DocumentVault.findAll({
      where: { applicant_id },
      order: [['id', 'DESC']],
    });

    const latestDocsMap = new Map();
    for (const doc of allVaultDocs) {
      if (!latestDocsMap.has(doc.document_type)) {
        latestDocsMap.set(doc.document_type, doc);
      }
    }

    const validVaultDocs = [];
    for (const doc of latestDocsMap.values()) {
      const isNonExpired = !doc.expiry_date || new Date(doc.expiry_date) >= now;
      if (doc.verified_status === 'verified' && isNonExpired) {
        validVaultDocs.push(doc);
      }
    }

    const vaultDocTypes = validVaultDocs.map((d) => d.document_type);
    const vaultDocIds = validVaultDocs.map((d) => d.id);

    // 1a. Document completeness validation
    const missingByApproval = [];
    for (const rule of rules) {
      const missing = rule.required_documents.filter(
        (docType) => !vaultDocTypes.includes(docType)
      );
      if (missing.length > 0) {
        missingByApproval.push({
          approval_name: rule.approval_name,
          department: rule.department,
          missing_documents: missing,
        });
      }
    }

    if (missingByApproval.length > 0) {
      return res.status(400).json({
        error: 'Missing required documents',
        missing_by_approval: missingByApproval,
      });
    }

    // Transaction for atomic submission and avoiding race conditions
    const createdApplications = await sequelize.transaction(async (t) => {
      const results = [];
      for (const rule of rules) {
        let existing = null;
        if (!allowResubmission) {
          existing = await Application.findOne({
            where: { applicant_id, approval_rule_id: rule.id },
            order: [['id', 'DESC']],
            transaction: t,
          });
        } else {
          existing = await Application.findOne({
            where: {
              applicant_id,
              approval_rule_id: rule.id,
              status: { [Op.notIn]: ['approved', 'auto_approved', 'rejected'] },
            },
            order: [['id', 'DESC']],
            transaction: t,
          });
        }

        if (existing) {
          results.push({
            application_id: existing.id,
            approval_name: rule.approval_name,
            department: rule.department,
            risk_level: existing.risk_level,
            status: existing.status,
            sla_deadline: existing.sla_deadline,
            already_existed: true,
          });
          continue;
        }

        const riskLevel = computeRiskLevel(rule, profile);
        const status = routeByRisk(riskLevel);

        const slaDeadline = new Date();
        slaDeadline.setDate(slaDeadline.getDate() + rule.sla_days);

        const application = await Application.create(
          {
            applicant_id,
            approval_rule_id: rule.id,
            status,
            risk_level: riskLevel,
            submitted_document_ids: vaultDocIds,
            sla_deadline: slaDeadline,
            decided_at: status === 'auto_approved' ? new Date() : null,
          },
          { transaction: t }
        );

        results.push({
          application_id: application.id,
          approval_name: rule.approval_name,
          department: rule.department,
          risk_level: riskLevel,
          status,
          sla_deadline: slaDeadline,
          already_existed: false,
        });
      }
      return results;
    });

    const hasNew = createdApplications.some((a) => !a.already_existed);
    const statusCode = hasNew ? 201 : 200;

    res.status(statusCode).json({
      message: `${createdApplications.length} approval application(s) processed`,
      applications: createdApplications,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (releaseLock) {
      releaseLock();
    }
  }
}

// Full status dashboard for one applicant, with a computed SLA countdown
// so the frontend can show "3 days left" / "SLA breached" per approval.
async function getApplicationsForApplicant(req, res) {
  try {
    const applicantId = req.params.applicantId;
    if (req.user.role === 'applicant') {
      const profile = await ApplicantProfile.findOne({
        where: { id: applicantId, user_id: req.user.id },
      });
      if (!profile) {
        return res.status(403).json({ error: 'Applicant profile not found or access denied' });
      }
    }

    const applications = await Application.findAll({
      where: { applicant_id: applicantId },
      include: [{ model: ApprovalRule }],
      order: [['submitted_at', 'DESC']],
    });

    const now = new Date();
    const enriched = applications.map((a) => {
      const daysLeft = Math.ceil((new Date(a.sla_deadline) - now) / (1000 * 60 * 60 * 24));
      return {
        id: a.id,
        approval_name: a.ApprovalRule.approval_name,
        department: a.ApprovalRule.department,
        status: a.status,
        risk_level: a.risk_level,
        sla_deadline: a.sla_deadline,
        days_left: daysLeft,
        sla_breached: daysLeft < 0 && !['approved', 'auto_approved', 'rejected'].includes(a.status),
      };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Officer/admin action: manually approve or reject a pending application.
async function decideApplication(req, res) {
  try {
    const { decision } = req.body; // 'approved' | 'rejected'
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
    }
    const application = await Application.findByPk(req.params.applicationId);
    if (!application) return res.status(404).json({ error: 'Application not found' });

    application.status = decision;
    application.decided_at = new Date();
    await application.save();

    res.json(application);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { submitApplication, getApplicationsForApplicant, decideApplication };
