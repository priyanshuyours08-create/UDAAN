module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('Inspections')) {
      console.log('[Migration] Inspections table does not exist. Skipping migration as it will be created natively on next sync.');
      return;
    }

    const tableInfo = await queryInterface.describeTable('Inspections');
    if (!tableInfo.completed_at) {
      console.log('[Migration] Adding completed_at to Inspections table...');
      await queryInterface.addColumn('Inspections', 'completed_at', {
        type: Sequelize.DATE,
        allowNull: true
      });
      console.log('[Migration] Added completed_at successfully.');
    } else {
      console.log('[Migration] completed_at column already exists. Skipping.');
    }
  }
};
