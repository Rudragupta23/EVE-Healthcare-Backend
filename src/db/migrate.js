'use strict';

// Usage: node src/db/migrate.js [up|down|reset]
const umzug = require('./umzug');
const sequelize = require('./index');

async function main() {
  const command = process.argv[2] || 'up';
  if (command === 'up') await umzug.up();
  else if (command === 'down') await umzug.down();
  else if (command === 'reset') await umzug.down({ to: 0 });
  else throw new Error(`Unknown command "${command}". Use up, down or reset.`);
  console.log(`Migrations "${command}" finished.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
