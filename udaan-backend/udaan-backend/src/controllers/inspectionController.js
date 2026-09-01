const { Op } = require('sequelize');
const {
  sequelize,
  ApplicantProfile,
  ApprovalRule,
  Application,
  User,
  Inspection,
  InspectionApplication,
} = require('../models');
const { withSqliteWriteLock } = require('../utils/sqliteWriteLock');

// Single-instance per-applicant mutex queue — same pattern as applicationController.
// Prevents two simultaneous bundle requests from creating duplicate inspections.
// NOTE: For multi-instance deployments, replace with Redis (redlock) or DB-level row locks.
const bundleLocks = new Map();

async function acquireBundleLock(applicantId) {
  let previousPromise = bundleLocks.get(applicantId) || Promise.resolve();
  let release;
  const currentPromise = new Promise((resolve) => {
    release = resolve;
  });
  bundleLocks.set(applicantId, previousPromise.then(() => currentPromise));

  await previousPromise;

  return () => {
    release();
    if (bundleLocks.get(applicantId) === currentPromise) {
      bundleLocks.delete(applicantId);
    }
  };
}

/**
 * POST /api/inspections/bundle
 *
 * Bundles all pending_inspection applications (whose rules require inspection)
 * for an applicant into a single scheduled inspection. Additive merge (FIX-3):
 * if a scheduled inspection already exists, newly eligible applications are
 * linked to it without creating duplicates.
 *
 * Auth: applicant (own profile only) or admin (any profile).
 * Officers and inspectors are rejected at the route middleware level.
 */
async function bundleInspections(req, res) {
  let releaseLock;
  try {
    const { applicant_id, scheduled_date } = req.body;

    if (!applicant_id) {
      return res.status(400).json({ error: 'applicant_id is required' });
    }

    // Ownership check — fail-closed
    let profile;
    if (req.user.role === 'applicant') {
      profile = await ApplicantProfile.findOne({
        where: { id: applicant_id, user_id: req.user.id },
      });
      if (!profile) {
        return res.status(403).json({ error: 'Applicant profile not found or access denied' });
      }
    } else if (req.user.role === 'admin') {
      profile = await ApplicantProfile.findByPk(applicant_id);
      if (!profile) {
        return res.status(404).json({ error: 'Applicant profile not found' });
      }
    } else {
      // Should not reach here due to authorize middleware, but fail-closed
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Validate scheduled_date if supplied
    let parsedScheduledDate = null;
    if (scheduled_date !== undefined && scheduled_date !== null) {
      parsedScheduledDate = new Date(scheduled_date);
      if (isNaN(parsedScheduledDate.getTime())) {
        return res.status(400).json({ error: 'scheduled_date must be a valid date' });
      }
    }

    // Acquire per-applicant mutex to prevent concurrent bundle races
    releaseLock = await acquireBundleLock(applicant_id);

    // Use IMMEDIATE transaction for SQLite safety
    const result = await withSqliteWriteLock(sequelize, async () => {
      return await sequelize.transaction(async (t) => {

      // Find eligible applications: pending_inspection + rule requires inspection
      const eligibleApplications = await Application.findAll({
        where: {
          applicant_id,
          status: 'pending_inspection',
        },
        include: [{
          model: ApprovalRule,
          where: { requires_inspection: true },
        }],
        transaction: t
      });

      // Look for existing scheduled inspection for this applicant
      const existingInspection = await Inspection.findOne({
        where: {
          applicant_id,
          status: 'scheduled',
        },
        transaction: t
      });

      // No existing scheduled inspection AND no eligible applications
      if (!existingInspection && eligibleApplications.length === 0) {
        return { earlyExit: true, status: 400, body: { error: 'No applications pending inspection for this applicant' } };
      }
      let inspection;
      let alreadyExisted = false;
      let newLinksCount = 0;

      if (existingInspection) {
        // Reuse existing scheduled inspection — additive merge (FIX-3)
        inspection = existingInspection;
        alreadyExisted = true;

        // Do NOT overwrite existing scheduled_date silently
        if (parsedScheduledDate && parsedScheduledDate.getTime() !== new Date(inspection.scheduled_date).getTime()) {
          // Ignore the supplied date for existing inspections — return as-is
        }

        // Get already-linked application IDs
        const existingLinks = await InspectionApplication.findAll({
          where: { inspection_id: inspection.id },
          transaction: t,
        });
        const alreadyLinkedIds = new Set(existingLinks.map((l) => l.application_id));

        // Add only new eligible applications
        for (const app of eligibleApplications) {
          if (!alreadyLinkedIds.has(app.id)) {
            await InspectionApplication.create(
              { inspection_id: inspection.id, application_id: app.id },
              { transaction: t }
            );
            newLinksCount++;
          }
        }
      } else {
        // Create new scheduled inspection
        // Validate scheduled_date is not in the past for new inspections
        if (parsedScheduledDate && parsedScheduledDate < new Date()) {
          throw { statusCode: 400, message: 'scheduled_date must not be in the past for a new inspection' };
        }

        const scheduledDateValue = parsedScheduledDate || (() => {
          const d = new Date();
          d.setDate(d.getDate() + 7);
          return d;
        })();

        inspection = await Inspection.create(
          {
            applicant_id,
            scheduled_date: scheduledDateValue,
            status: 'scheduled',
          },
          { transaction: t }
        );

        // Link all eligible applications
        for (const app of eligibleApplications) {
          await InspectionApplication.create(
            { inspection_id: inspection.id, application_id: app.id },
            { transaction: t }
          );
          newLinksCount++;
        }
      }

      // Reload with associations for response
      const fullInspection = await Inspection.findByPk(inspection.id, {
        include: [
          {
            model: User,
            as: 'Inspector',
            attributes: ['id', 'name', 'email', 'role', 'department'],
          },
          {
            model: Application,
            include: [{ model: ApprovalRule, attributes: ['approval_name', 'department'] }],
          },
        ],
        transaction: t,
      });

      return { inspection: fullInspection, alreadyExisted, newLinksCount };
      });
    });

    if (result.earlyExit) {
      return res.status(result.status).json(result.body);
    }

    res.status(alreadyExistedStatus(result.alreadyExisted)).json({
      message: result.alreadyExisted
        ? (result.newLinksCount > 0
          ? `Existing inspection updated with ${result.newLinksCount} new application(s)`
          : 'Existing scheduled inspection found — no new applications to add')
        : `New inspection created with ${result.newLinksCount} application(s) linked`,
      inspection: result.inspection,
      already_existed: result.alreadyExisted,
      new_links_added: result.newLinksCount,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  } finally {
    if (releaseLock) {
      releaseLock();
    }
  }
}

function alreadyExistedStatus(alreadyExisted) {
  return alreadyExisted ? 200 : 201;
}

/**
 * GET /api/inspections/:applicantId
 *
 * Lists inspections for an applicant.
 * - Applicants: own inspections only.
 * - Admins: any applicant's inspections.
 * - Inspectors: only when at least one inspection for the applicant is assigned
 *   to them. Returns only their assigned inspections, not the full list.
 * Officers are rejected at the route middleware level.
 */
async function getInspections(req, res) {
  try {
    const applicantId = parseInt(req.params.applicantId, 10);
    if (isNaN(applicantId)) {
      return res.status(400).json({ error: 'Invalid applicantId' });
    }

    // Verify applicant profile exists
    const profile = await ApplicantProfile.findByPk(applicantId);
    if (!profile) {
      return res.status(404).json({ error: 'Applicant profile not found' });
    }

    if (req.user.role === 'applicant') {
      // Applicants may view only their own inspections
      if (profile.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Access denied — you can only view your own inspections' });
      }

      const inspections = await Inspection.findAll({
        where: { applicant_id: applicantId },
        include: [
          {
            model: User,
            as: 'Inspector',
            attributes: ['id', 'name', 'email', 'role', 'department'],
          },
          {
            model: Application,
            include: [{ model: ApprovalRule, attributes: ['approval_name', 'department'] }],
          },
        ],
        order: [['createdAt', 'DESC']],
      });

      return res.json(inspections);

    } else if (req.user.role === 'admin') {
      // Admins may view any applicant's inspections
      const inspections = await Inspection.findAll({
        where: { applicant_id: applicantId },
        include: [
          {
            model: User,
            as: 'Inspector',
            attributes: ['id', 'name', 'email', 'role', 'department'],
          },
          {
            model: Application,
            include: [{ model: ApprovalRule, attributes: ['approval_name', 'department'] }],
          },
        ],
        order: [['createdAt', 'DESC']],
      });

      return res.json(inspections);

    } else if (req.user.role === 'inspector') {
      // Inspectors: may access only when at least one inspection for this
      // applicant is assigned to them. Return only their assigned inspections.
      const assignedInspections = await Inspection.findAll({
        where: {
          applicant_id: applicantId,
          assigned_inspector_id: req.user.id,
        },
        include: [
          {
            model: User,
            as: 'Inspector',
            attributes: ['id', 'name', 'email', 'role', 'department'],
          },
          {
            model: Application,
            include: [{ model: ApprovalRule, attributes: ['approval_name', 'department'] }],
          },
        ],
        order: [['createdAt', 'DESC']],
      });

      if (assignedInspections.length === 0) {
        return res.status(403).json({ error: 'Access denied — no inspections assigned to you for this applicant' });
      }

      return res.json(assignedInspections);

    } else {
      // Fail-closed: should not reach here due to authorize middleware
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * PATCH /api/inspections/:inspectionId/assign
 *
 * Admin-only: assigns an inspector to an inspection.
 * The target user must exist and have role 'inspector'.
 * Cannot assign cancelled or completed inspections.
 */
async function assignInspector(req, res) {
  try {
    const inspectionId = parseInt(req.params.inspectionId, 10);
    if (isNaN(inspectionId)) {
      return res.status(400).json({ error: 'Invalid inspectionId' });
    }

    const inspection = await Inspection.findByPk(inspectionId);
    if (!inspection) {
      return res.status(404).json({ error: 'Inspection not found' });
    }

    if (inspection.status === 'cancelled' || inspection.status === 'completed') {
      return res.status(409).json({ error: `Cannot assign inspector to a ${inspection.status} inspection` });
    }

    const { assigned_inspector_id } = req.body;
    if (!assigned_inspector_id) {
      return res.status(400).json({ error: 'assigned_inspector_id is required' });
    }

    // Verify target user exists — do NOT trust any role/department from the request body
    const inspector = await User.findByPk(assigned_inspector_id);
    if (!inspector) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Target must be an inspector — reject applicant, officer, admin
    if (inspector.role !== 'inspector') {
      return res.status(400).json({ error: 'Assigned user must have role inspector' });
    }

    inspection.assigned_inspector_id = assigned_inspector_id;
    await inspection.save();

    // Reload with safe inspector details
    const updated = await Inspection.findByPk(inspection.id, {
      include: [
        {
          model: User,
          as: 'Inspector',
          attributes: ['id', 'name', 'email', 'role', 'department'],
        },
        {
          model: Application,
          include: [{ model: ApprovalRule, attributes: ['approval_name', 'department'] }],
        },
      ],
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Single-instance per-inspection mutex queue — same pattern as bundleLocks
// (Priority 1) and submitLocks (applicationController).
//
// Serializes concurrent completion requests for the SAME inspection while
// allowing completion of DIFFERENT inspections to proceed in parallel.
//
// NOTE: This mutex protects the current single-instance SIH deployment.
// For multi-instance deployments (multiple Node.js processes), replace with
// Redis (redlock) or DB-level advisory locks. The conditional UPDATE
// (compare-and-set) below provides a final safety net even without the mutex.
// ---------------------------------------------------------------------------
const completionLocks = new Map();

async function acquireCompletionLock(inspectionId) {
  const previousPromise = completionLocks.get(inspectionId) || Promise.resolve();

  let release;
  const currentPromise = new Promise((resolve) => {
    release = resolve;
  });

  const tailPromise = previousPromise.then(() => currentPromise);
  completionLocks.set(inspectionId, tailPromise);

  await previousPromise;

  let released = false;

  return () => {
    if (released) return;
    released = true;

    release();

    if (completionLocks.get(inspectionId) === tailPromise) {
      completionLocks.delete(inspectionId);
    }
  };
}

// ---------------------------------------------------------------------------
// SQLite-specific global completion-writer queue.
//
// SQLite supports only one writer at a time. When two different-inspection
// completion requests open IMMEDIATE transactions concurrently, one fails
// with "SQLITE_ERROR: cannot commit - no transaction is active" because
// Sequelize kills the blocked connection.
//
// This queue serializes the managed completion transaction across ALL
// inspections when the dialect is SQLite. It does NOT apply to PostgreSQL,
// MySQL or other databases that support concurrent write transactions.
//
// Lock order (consistent, avoids deadlocks):
//   1. Per-inspection mutex   (acquireCompletionLock)
//   2. SQLite writer queue    (acquireSqliteWriterLock)  — only if SQLite
//   3. Sequelize transaction
//   4. Release SQLite writer  — inner finally
//   5. Release per-inspection — outer finally
//
// Uses the same corrected tailPromise pattern as acquireCompletionLock.
// ---------------------------------------------------------------------------
/**
 * PATCH /api/inspections/:inspectionId/complete
 *
 * Completes an inspection. Only the assigned inspector or an admin may complete.
 * Atomically updates the inspection and all linked pending_inspection applications.
 *
 * Concurrency-safe via three layers:
 *   1. Per-inspection mutex queue (single-instance serialization)
 *   2. Authoritative checks re-fetched inside the transaction
 *   3. Conditional UPDATE ... WHERE status = 'scheduled' (database CAS guard)
 *
 * Result mapping:
 *   pass        → linked apps become approved
 *   fail        → linked apps become rejected
 *   conditional → linked apps become pending_review
 */
async function completeInspection(req, res) {
  let releaseLock;
  try {
    const inspectionId = parseInt(req.params.inspectionId, 10);
    if (isNaN(inspectionId)) {
      return res.status(400).json({ error: 'Invalid inspectionId' });
    }

    // Validate result before acquiring the lock — fail fast on invalid input
    const { result, inspector_notes } = req.body;
    const validResults = ['pass', 'fail', 'conditional'];
    if (!validResults.includes(result)) {
      return res.status(400).json({ error: `result must be one of: ${validResults.join(', ')}` });
    }

    // Require meaningful notes for fail and conditional
    if ((result === 'fail' || result === 'conditional') && (!inspector_notes || inspector_notes.trim().length === 0)) {
      return res.status(400).json({ error: `inspector_notes are required for result '${result}'` });
    }

    // Result → application status mapping
    const statusMap = {
      pass: 'approved',
      fail: 'rejected',
      conditional: 'pending_review',
    };

    // -----------------------------------------------------------------------
    // Lock 1: Acquire per-inspection mutex to serialize same-inspection
    //          concurrent requests (provides correct HTTP 409 semantics).
    // -----------------------------------------------------------------------
    releaseLock = await acquireCompletionLock(inspectionId);

    // -----------------------------------------------------------------------
    // Lock 2 (SQLite only): Acquire global completion-writer lock to
    //          serialize IMMEDIATE transactions across different inspections.
    //          Not needed for PostgreSQL/MySQL which support concurrent writers.
    // -----------------------------------------------------------------------
    // ---------------------------------------------------------------------
      // Layer 2: Start transaction and re-fetch authoritative state
      // ---------------------------------------------------------------------
      const txResult = await withSqliteWriteLock(sequelize, async () => {
        return await sequelize.transaction(async (t) => {
        // Re-fetch the inspection INSIDE the transaction — never trust a
        // pre-lock / pre-transaction read.
        const inspection = await Inspection.findByPk(inspectionId, {
          include: [{
            model: Application,
            include: [{ model: ApprovalRule, attributes: ['approval_name', 'department'] }],
          }],
          transaction: t,
        });

        // --- Authoritative existence check ---
        if (!inspection) {
          return { earlyExit: true, status: 404, body: { error: 'Inspection not found' } };
        }

        // --- Authoritative cancelled check ---
        if (inspection.status === 'cancelled') {
          return { earlyExit: true, status: 409, body: { error: 'Cannot complete a cancelled inspection' } };
        }

        // --- Authoritative already-completed check ---
        if (inspection.status === 'completed') {
          const existing = await Inspection.findByPk(inspection.id, {
            include: [
              {
                model: User,
                as: 'Inspector',
                attributes: ['id', 'name', 'email', 'role', 'department'],
              },
              {
                model: Application,
                include: [{ model: ApprovalRule, attributes: ['approval_name', 'department'] }],
              },
            ],
            transaction: t,
          });
          return {
            earlyExit: true,
            status: 409,
            body: { error: 'Inspection is already completed', inspection: existing },
          };
        }

        // --- Authoritative authorization check ---
        if (req.user.role === 'inspector') {
          if (!inspection.assigned_inspector_id) {
            return { earlyExit: true, status: 403, body: { error: 'This inspection has no assigned inspector' } };
          }
          if (inspection.assigned_inspector_id !== req.user.id) {
            return { earlyExit: true, status: 403, body: { error: 'You are not the assigned inspector for this inspection' } };
          }
        }
        // Admin bypasses the assignment check (per spec)

        // Inspection must have an assigned inspector to be completed
        if (!inspection.assigned_inspector_id) {
          return { earlyExit: true, status: 400, body: { error: 'Cannot complete an inspection with no assigned inspector' } };
        }

        // -----------------------------------------------------------------
        // Layer 3: Conditional UPDATE — database-level compare-and-set guard.
        // Atomically claims completion only when status is still 'scheduled'.
        // This is the final protection if the app later runs in more than one
        // Node.js process (where the in-memory mutex cannot help).
        // -----------------------------------------------------------------
        const completedAt = new Date();
        const [affectedRows] = await Inspection.update(
          {
            status: 'completed',
            result: result,
            inspector_notes: inspector_notes || null,
            completed_at: completedAt,
          },
          {
            where: {
              id: inspectionId,
              status: 'scheduled',
            },
            transaction: t,
          }
        );

        if (affectedRows === 0) {
          // Another request already changed the status — re-fetch to determine
          // the current state for an accurate response.
          const current = await Inspection.findByPk(inspectionId, { transaction: t });
          if (current && (current.status === 'completed' || current.status === 'cancelled')) {
            const label = current.status === 'completed'
              ? 'Inspection is already completed'
              : 'Cannot complete a cancelled inspection';
            return { earlyExit: true, status: 409, body: { error: label } };
          }
          // Unexpected status — should not happen, but fail safely
          return { earlyExit: true, status: 409, body: { error: 'Inspection status has changed, completion rejected' } };
        }
        // Update linked applications atomically within the same transaction
        const newStatus = statusMap[result];
        const linkedApps = await Application.findAll({
          where: {
            id: { [Op.in]: inspection.Applications.map((a) => a.id) },
            status: 'pending_inspection', // Only update apps still in pending_inspection
          },
          transaction: t,
        });

        for (const app of linkedApps) {
          app.status = newStatus;
          app.decided_at = new Date();
          await app.save({ transaction: t });
        }

        return { earlyExit: false };
        });
      });

      // Handle early-exit responses from authoritative checks inside the transaction
      if (txResult.earlyExit) {
        return res.status(txResult.status).json(txResult.body);
      }

      // Reload with full details for response
      const finalInspection = await Inspection.findByPk(inspectionId, {
        include: [
          {
            model: User,
            as: 'Inspector',
            attributes: ['id', 'name', 'email', 'role', 'department'],
          },
          {
            model: Application,
            include: [{ model: ApprovalRule, attributes: ['approval_name', 'department'] }],
          },
        ],
      });

      res.json({
        message: 'Inspection completed successfully',
        inspection: finalInspection,
      });
  } catch (err) {
    console.error('[InspectionController completeInspection] Unexpected error');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    // Always release the per-inspection lock — an error must never leave
    // an inspection permanently locked.
    if (releaseLock) {
      releaseLock();
    }
  }
}

module.exports = { bundleInspections, getInspections, assignInspector, completeInspection };
