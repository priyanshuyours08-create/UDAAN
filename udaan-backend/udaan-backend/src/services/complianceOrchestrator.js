const { checkAndEscalate } = require('./slaEscalationService');
const { checkGrievanceEscalations } = require('./grievanceEscalationService');

// Use narrow dependency injection for tests
async function runComplianceChecks(options = {}) {
  const slaChecker = options.slaChecker || checkAndEscalate;
  const grievanceChecker = options.grievanceChecker || checkGrievanceEscalations;

  let slaResult = { success: false, error: 'SLA_CHECK_FAILED' };
  let grievanceResult = { success: false, error: 'GRIEVANCE_CHECK_FAILED' };

  const slaPromise = (async () => {
    try {
      const data = await slaChecker(options);
      slaResult = { success: true, data };
    } catch (err) {
      console.error('[ComplianceOrchestrator] SLA Check failed:', err);
      // Safe error only
    }
  })();

  const grievancePromise = (async () => {
    try {
      const data = await grievanceChecker(options);
      grievanceResult = { success: true, data };
    } catch (err) {
      console.error('[ComplianceOrchestrator] Grievance Check failed:', err);
      // Safe error only
    }
  })();

  // Execute both checks concurrently with failure isolation
  await Promise.all([slaPromise, grievancePromise]);

  const bothSucceed = slaResult.success && grievanceResult.success;
  const oneSucceeds = slaResult.success || grievanceResult.success;

  return {
    success: bothSucceed,
    partial_failure: !bothSucceed && oneSucceeds,
    sla: slaResult,
    grievances: grievanceResult
  };
}

module.exports = {
  runComplianceChecks
};
