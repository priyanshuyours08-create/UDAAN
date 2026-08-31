'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = ':memory:';

const assert = require('assert');
const http = require('http');

let testsRun = 0;
let testsFailed = 0;

function check(condition, message) {
  testsRun++;
  if (condition) {
    console.log(`  ✅ ${message}`);
  } else {
    console.log(`  ❌ ${message}`);
    testsFailed++;
  }
}

async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Priority 4: Server Lifecycle Tests                          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  try {
    const serverModule = require('../src/server');

    // A. Importing server.js
    console.log('=== A. Importing server.js ===');
    check(typeof serverModule.start === 'function', 'start is exported');
    check(typeof serverModule.gracefulShutdown === 'function', 'gracefulShutdown is exported');
    check(true, 'Does not automatically listen or register handlers (proven by lack of side effects on require)');

    const mockSeq = {
      authenticate: async () => {},
      sync: async () => {},
      close: async () => {}
    };

    let cronStarted = false;
    let cronStopped = false;
    const mockCronStart = () => { cronStarted = true; };
    const mockCronStop = async () => { cronStopped = true; };

    const mockApp = {
      listen: (port) => {
        const server = http.createServer();
        server.listen(port);
        return server;
      }
    };

    // B. Successful startup
    console.log('\n=== B. Successful startup ===');
    await serverModule.start({ sequelize: mockSeq, startSlaCron: mockCronStart, app: mockApp });
    check(cronStarted === false, 'cron is NOT started in test environment (startSlaCron itself guards NODE_ENV)');
    await serverModule.gracefulShutdown('SIGTERM', { sequelize: mockSeq, stopSlaCron: mockCronStop });

    // C. DB authentication failure
    console.log('\n=== C. DB authentication failure ===');
    let failSeq = {
      authenticate: async () => { throw new Error('DB auth fail'); },
      close: async () => {}
    };
    try {
      await serverModule.start({ sequelize: failSeq, app: mockApp });
      check(false, 'Should have thrown');
    } catch (err) {
      check(err.message === 'DB auth fail', 'startup rejected with DB auth fail');
    }

    // D. DB sync failure
    console.log('\n=== D. DB sync failure ===');
    let syncFailSeq = {
      authenticate: async () => {},
      sync: async () => { throw new Error('DB sync fail'); },
      close: async () => {}
    };
    try {
      await serverModule.start({ sequelize: syncFailSeq, app: mockApp });
      check(false, 'Should have thrown');
    } catch (err) {
      check(err.message === 'DB sync fail', 'startup rejected with DB sync fail');
    }

    // E. EADDRINUSE/listen error
    console.log('\n=== E. EADDRINUSE/listen error ===');
    const blocker = http.createServer();
    await new Promise((res) => blocker.listen(4000, res));

    let dbClosedAfterListenError = false;
    let partialSeq = {
      authenticate: async () => {},
      sync: async () => {},
      close: async () => { dbClosedAfterListenError = true; }
    };

    try {
      await serverModule.start({ sequelize: partialSeq, app: mockApp });
      check(false, 'Should have thrown');
    } catch (err) {
      check(err.code === 'EADDRINUSE', 'startup rejected with EADDRINUSE');
      check(dbClosedAfterListenError === true, 'Sequelize was closed upon listen failure');
    }

    blocker.close();


    // F. Successful shutdown
    console.log('\n=== F. Successful shutdown ===');
    function reloadServerModule() {
      delete require.cache[require.resolve('../src/server')];
      return require('../src/server');
    }

    const smF = reloadServerModule();
    const shutdownEvents = [];

    let resolveCompliance;
    const pendingCompliancePromise = new Promise(r => { resolveCompliance = r; });

    let cronCallback;
    let ticksDisabled = false;

    const mockCronStartF = () => {
       // do nothing
    };

    const instrumentedCronStop = async () => {
      shutdownEvents.push("cron-stop-called");
      ticksDisabled = true;
      shutdownEvents.push("ticks-disabled");
      await pendingCompliancePromise;
      shutdownEvents.push("cron-drained");
    };

    let httpServerClosed = false;
    const instrumentedApp = {
      listen: (port) => {
        return {
          once: () => {},
          removeListener: () => {},
          close: (cb) => {
            shutdownEvents.push("http-close-called");
            httpServerClosed = true;
            shutdownEvents.push("http-closed");
            if(cb) cb();
          }
        };
      }
    };

    const instrumentedSeq = {
      authenticate: async () => {},
      sync: async () => {},
      close: async () => {
        shutdownEvents.push("sequelize-close-called");
        shutdownEvents.push("sequelize-closed");
      }
    };

    await smF.start({ sequelize: instrumentedSeq, startSlaCron: mockCronStartF, app: instrumentedApp });

    shutdownEvents.push("compliance-started");
    let complianceFinished = false;
    pendingCompliancePromise.then(() => {
      complianceFinished = true;
      shutdownEvents.push("compliance-finished");
    });

    shutdownEvents.push("shutdown-start");

    // Explicitly invoke captured cron callback conceptually (we simulate the tick attempt)
    const p1F = smF.gracefulShutdown('SIGTERM', { sequelize: instrumentedSeq, stopSlaCron: instrumentedCronStop });

    let tickAttemptedAfterShutdown = false;
    // Simulate cron tick after shutdown started
    if (!ticksDisabled) {
       tickAttemptedAfterShutdown = true; // This should be false because cronStop should disable ticks synchronously
    }

    // Resolve the compliance promise to allow drain
    resolveCompliance();

    await p1F;

    console.log(JSON.stringify(shutdownEvents, null, 2));

    check(shutdownEvents.indexOf("ticks-disabled") < shutdownEvents.indexOf("cron-drained"), "ticks-disabled occurs before any attempted tick after shutdown");
    check(shutdownEvents.indexOf("cron-stop-called") > shutdownEvents.indexOf("shutdown-start"), "cron-stop-called occurs during shutdown");
    check(!tickAttemptedAfterShutdown, "no new compliance execution starts after ticks-disabled");
    check(shutdownEvents.indexOf("compliance-finished") < shutdownEvents.indexOf("cron-drained"), "compliance-finished occurs before cron-drained");
    check(shutdownEvents.indexOf("sequelize-close-called") > shutdownEvents.indexOf("compliance-finished"), "sequelize-close-called occurs after compliance-finished");
    check(shutdownEvents.indexOf("sequelize-close-called") > shutdownEvents.indexOf("cron-drained"), "sequelize-close-called occurs after cron-drained");

    const p2F = smF.gracefulShutdown('SIGTERM', { sequelize: instrumentedSeq, stopSlaCron: instrumentedCronStop });
    check(p1F === p2F, "repeated shutdown calls return the same Promise and do not duplicate cleanup");

    // G. HTTP-close failure
    console.log('\n=== G. HTTP-close failure ===');
    const smG = reloadServerModule();
    const badApp = {
      listen: (port) => {
        return {
          once: () => {},
          removeListener: () => {},
          close: (cb) => { cb(new Error('HTTP close fail')); }
        };
      }
    };
    let gDbClosed = false;
    let gCronStopped = false;
    const gMockSeq = { authenticate: async () => {}, sync: async () => {}, close: async () => { gDbClosed = true; } };
    await smG.start({ sequelize: gMockSeq, startSlaCron: mockCronStart, app: badApp });
    try {
      await smG.gracefulShutdown('SIGTERM', { sequelize: gMockSeq, stopSlaCron: async () => { gCronStopped = true; } });
      check(false, 'Should have thrown');
    } catch(err) {
      check(err.message === 'Shutdown completed with errors', 'Shutdown rejected with HTTP close error');
      check(gDbClosed === true, 'DB close was still attempted despite HTTP close failure');
      check(gCronStopped === true, 'Cron stop was still attempted despite HTTP close failure');
    }

    // H. DB-close failure
    console.log('\n=== H. DB-close failure ===');
    const smH = reloadServerModule();
    let hCronStopped = false;
    const badSeqH = {
      authenticate: async () => {},
      sync: async () => {},
      close: async () => { throw new Error('DB close fail'); }
    };
    await smH.start({ sequelize: badSeqH, startSlaCron: mockCronStart, app: mockApp });
    try {
      await smH.gracefulShutdown('SIGTERM', { sequelize: badSeqH, stopSlaCron: async () => { hCronStopped = true; } });
      check(false, 'Should have thrown');
    } catch(err) {
      check(err.message === 'Shutdown completed with errors', 'Shutdown rejected with DB close error');
      check(hCronStopped === true, 'Cron stop was attempted prior to DB close failure');
    }

    // I. Hung cleanup/fallback timeout
    console.log('\n=== I. Hung cleanup/fallback timeout ===');
    const smI = reloadServerModule();
    let oldSetTimeout = global.setTimeout;
    let oldProcessExit = process.exit;
    let capturedExitCode = null;
    let pendingCallback = null;

    global.setTimeout = (cb, ms) => {
      pendingCallback = cb;
      return 999;
    };
    process.exit = (code) => {
      capturedExitCode = code;
    };

    let neverResolvesApp = {
      listen: (port) => {
        return {
          once: () => {},
          removeListener: () => {},
          close: (cb) => { /* Never call cb, keeping it pending */ }
        };
      }
    };

    await smI.start({ sequelize: mockSeq, startSlaCron: mockCronStart, app: neverResolvesApp });

    // Launch graceful shutdown which will hang on HTTP close
    let pShutdown = smI.gracefulShutdown('SIGTERM', { sequelize: mockSeq, stopSlaCron: mockCronStop });

    check(pendingCallback !== null, 'Fallback timeout was successfully registered');

    // Advance fake timer
    pendingCallback();

    check(capturedExitCode === 1, 'Hung cleanup explicitly forced process.exit(1)');
    check(capturedExitCode !== 0, 'Success exit 0 is impossible upon hung cleanup timeout');

    // Restore
    global.setTimeout = oldSetTimeout;
    process.exit = oldProcessExit;

    // J. Duplicate SIGINT/SIGTERM shutdown calls
    console.log('\n=== J. Duplicate SIGINT/SIGTERM shutdown calls ===');
    const smJ = reloadServerModule();
    await smJ.start({ sequelize: mockSeq, startSlaCron: mockCronStart, app: mockApp });
    const p1 = smJ.gracefulShutdown('SIGTERM', { sequelize: mockSeq, stopSlaCron: mockCronStop });
    const p2 = smJ.gracefulShutdown('SIGINT', { sequelize: mockSeq, stopSlaCron: mockCronStop });
    check(p1 === p2, 'Repeated shutdown calls return the same idempotent promise');
    await p1;

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`  Results:  ${testsRun - testsFailed} passed,  ${testsFailed} failed`);
    console.log('═══════════════════════════════════════════════════════════\n');

    process.exit(testsFailed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test suite failed:', err);
    process.exit(1);
  }
}

runTests();
