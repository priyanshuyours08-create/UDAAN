require('dotenv').config();
const app = require('./app');
const { sequelize } = require('./models');
const { startSlaCron, stopSlaCron } = require('./services/slaCronService');

const PORT = process.env.PORT || 4000;
let serverInstance = null;
let isShuttingDown = false;
let shutdownPromise = null;

async function start(deps = {}) {
  if (serverInstance) {
    throw new Error('Server is already running');
  }

  const db = deps.sequelize || sequelize;
  const cronStart = deps.startSlaCron || startSlaCron;
  const listenApp = deps.app || app;
  const port = deps.port || PORT;

  let listeningServer = null;

  try {
    await db.authenticate();
    await db.sync();
    console.log('Database connected and synced.');

    await new Promise((resolve, reject) => {
      listeningServer = listenApp.listen(port);

      const onListening = () => {
        listeningServer.removeListener('error', onError);
        serverInstance = listeningServer;
        resolve();
      };

      const onError = (err) => {
        listeningServer.removeListener('listening', onListening);
        reject(err);
      };

      listeningServer.once('listening', onListening);
      listeningServer.once('error', onError);
    });

    console.log(`UDAAN backend running on http://localhost:${port}`);

    if (process.env.NODE_ENV !== 'test') {
      cronStart();
      console.log('SLA escalation cron registered.');
    }
  } catch (err) {
    console.error('Failed to start server:', err);
    if (listeningServer) {
      listeningServer.close();
    }
    try {
      await db.close();
    } catch (e) {
      // ignore
    }
    throw err;
  }
}

function gracefulShutdown(signal, deps = {}) {
  if (isShuttingDown) return shutdownPromise;
  isShuttingDown = true;
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);

  const db = deps.sequelize || sequelize;
  const cronStop = deps.stopSlaCron || stopSlaCron;

  shutdownPromise = (async () => {
    let hasError = false;

    // 2. Synchronously stop future cron ticks and obtain its drain Promise.
    const cronDrainPromise = cronStop().catch((err) => {
      console.error('Error stopping cron:', err);
      hasError = true;
    });

    // 3 & 4. Immediately initiate HTTP server close so no new requests are accepted and await it.
    if (serverInstance) {
      try {
        await new Promise((resolve, reject) => {
          serverInstance.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        console.log('HTTP server closed.');
      } catch (err) {
        console.error('Error closing HTTP server:', err);
        hasError = true;
      }
    }

    // 5. Await the already-running SLA Promise.
    await cronDrainPromise;
    if (!hasError) {
      console.log('SLA cron stopped and drained.');
    }

    // 3. Close Sequelize
    try {
      await db.close();
      console.log('Database connection closed.');
    } catch (dbErr) {
      console.error('Error closing database connection:', dbErr);
      hasError = true;
    }

    if (hasError) {
      throw new Error('Shutdown completed with errors');
    }
  })();

  return shutdownPromise;
}

let handlersRegistered = false;

function registerSignalHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const handleSignal = (signal) => {
    // 7. Fallback timeout covers the entire operation and exits 1 if hung
    const timeoutId = setTimeout(() => {
      console.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);
    timeoutId.unref(); // in case something else is keeping loop alive

    gracefulShutdown(signal)
      .then(() => {
        clearTimeout(timeoutId);
        process.exitCode = 0;
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        process.exitCode = 1;
      });
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
}

if (require.main === module) {
  registerSignalHandlers();
  start().catch((err) => {
    process.exitCode = 1;
  });
}

module.exports = {
  start,
  gracefulShutdown,
  registerSignalHandlers
};
