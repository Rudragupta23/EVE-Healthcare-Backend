'use strict';

// Rebuilds the test database schema from the migrations once before the whole test run.
module.exports = async () => {
  require('./env');
  const umzug = require('../../src/db/umzug');
  const sequelize = require('../../src/db');
  await umzug.down({ to: 0 });
  await umzug.up();
  await sequelize.close();
};
