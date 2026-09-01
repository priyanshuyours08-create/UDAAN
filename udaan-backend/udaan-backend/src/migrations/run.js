const { Sequelize } = require('sequelize');
const migration01 = require('./01_add_inspection_completed_at');

async function runMigrations(sequelizeInstance) {
  let sequelize = sequelizeInstance;

  if (!sequelize) {
    sequelize = require('../models').sequelize;
  }

  let migrationError = null;
  try {
    await sequelize.authenticate();
    const queryInterface = sequelize.getQueryInterface();
    await migration01.up(queryInterface, Sequelize);
    console.log('[Migration] Migration complete');
  } catch (error) {
    console.error('[Migration] Migration failed');
    migrationError = error;
  } finally {
    if (sequelize) {
      try {
        await sequelize.close();
        console.log('[Migration] Database connection closed safely');
      } catch (closeError) {
        console.error('[Migration] Failed to close database connection safely');
        if (migrationError) {
          migrationError.closeError = closeError;
        } else {
          migrationError = closeError;
        }
      }
    }
  }

  if (migrationError) {
    throw migrationError;
  }
}

if (require.main === module) {
  runMigrations().catch(() => {
    process.exitCode = 1;
  });
}

module.exports = { runMigrations };
