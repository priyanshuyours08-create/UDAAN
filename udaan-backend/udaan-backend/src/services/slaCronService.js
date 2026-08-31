const realCron = require('node-cron');
const { runComplianceChecks: realRunComplianceChecks } = require('./complianceOrchestrator');
const realLogger = console;

let activeTask = null;
let acceptingTicks = false;
let isSlaCheckRunning = false;
let activeSlaPromise = null;

function startSlaCron(deps = {}) {
  const cron = deps.cron || realCron;
  const runComplianceChecks = deps.runComplianceChecks || realRunComplianceChecks;
  const logger = deps.logger || realLogger;

  if (activeTask) {
    acceptingTicks = true;
    return activeTask;
  }

  // Prevent automatic scheduling in test environment if using real cron
  if (process.env.NODE_ENV === 'test' && !deps.cron) {
    return null;
  }

  activeTask = cron.schedule('*/5 * * * *', async () => {
    if (!acceptingTicks) {
      return;
    }
    
    if (isSlaCheckRunning) {
      logger.log('Compliance check skipped: previous tick is still running');
      return;
    }

    isSlaCheckRunning = true;
    
    const currentPromise = (async () => {
      try {
        const results = await runComplianceChecks(deps.complianceOptions || {});
        if (!results.success) {
          logger.warn('Compliance check completed with failures:', results);
        }
      } catch (error) {
        logger.error('Error during compliance cron execution:', error);
      } finally {
        isSlaCheckRunning = false;
        if (activeSlaPromise === currentPromise) {
          activeSlaPromise = null;
        }
      }
    })();
    
    activeSlaPromise = currentPromise;
    await currentPromise;
  });

  acceptingTicks = true;
  return activeTask;
}

async function stopSlaCron() {
  acceptingTicks = false;
  if (activeTask) {
    activeTask.stop();
    activeTask = null;
  }
  
  if (activeSlaPromise) {
    try {
      await activeSlaPromise;
    } catch (err) {
      // should be caught internally by finally block, but just in case
    }
  }
}

module.exports = {
  startSlaCron,
  stopSlaCron
};
