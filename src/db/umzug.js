'use strict';

const path = require('path');
const { Umzug, SequelizeStorage } = require('umzug');
const { Sequelize } = require('sequelize');
const sequelize = require('./index');
const logger = require('../utils/logger');

// Versioned, repeatable schema changes. Applied migrations are tracked in the "SequelizeMeta" table.
const umzug = new Umzug({
  migrations: {
    glob: path.join(__dirname, 'migrations/*.js').replace(/\\/g, '/'),
    resolve: ({ name, path: file, context }) => {
      const migration = require(file);
      return {
        name,
        up: () => migration.up({ queryInterface: context, Sequelize }),
        down: () => migration.down({ queryInterface: context, Sequelize }),
      };
    },
  },
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({ sequelize }),
  logger: { info: (m) => logger.info(m), warn: (m) => logger.warn(m), error: (m) => logger.error(m), debug: () => {} },
});

module.exports = umzug;
