'use strict';

const { Sequelize } = require('sequelize');
const config = require('../config');
const logger = require('../utils/logger');

const sequelize = new Sequelize(config.databaseUrl, {
  dialect: 'postgres',
  logging: (sql) => logger.trace({ sql }, 'sql'),
  define: { underscored: true, timestamps: true },
  pool: { max: 10, min: 0, idle: 10_000 },
});

module.exports = sequelize;
