const { Sequelize } = require('sequelize');
require('dotenv').config();

let sequelize;

if (process.env.DB_DIALECT === 'postgres') {
  sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      dialect: 'postgres',
      logging: false,
    }
  );
} else {
  // Default: SQLite — zero setup, perfect for hackathon dev/demo.
  // Switch DB_DIALECT=postgres in .env for production/deployment.
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: process.env.DB_STORAGE || './udaan.sqlite',
    logging: false,
    dialectOptions: {
      timeout: 15000,
    },
    transactionType: 'IMMEDIATE',
  });
}

module.exports = sequelize;
