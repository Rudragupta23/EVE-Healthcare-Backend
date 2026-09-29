'use strict';

const { Op, UniqueConstraintError, fn, col, where } = require('sequelize');
const { Centre, Test, CentreTest } = require('../../models');
const { notFound, conflict } = require('../../utils/errors');
const { toOffset } = require('../../utils/pagination');

// Public listings only show tests a centre is currently offering.
const availableTests = {
  model: Test,
  as: 'tests',
  through: { attributes: ['pricePaise', 'isAvailable'], where: { isAvailable: true } },
  required: false,
};

async function listCentres({ page, limit, city, test_id: testId }) {
  const filters = [];
  if (city) filters.push(where(fn('lower', col('Centre.city')), city.toLowerCase()));
  if (testId) {
    const offering = await CentreTest.findAll({ where: { testId, isAvailable: true }, attributes: ['centreId'] });
    filters.push({ id: { [Op.in]: offering.map((o) => o.centreId) } });
  }

  const { rows, count } = await Centre.findAndCountAll({
    where: { [Op.and]: filters },
    include: [availableTests],
    order: [['name', 'ASC'], [{ model: Test, as: 'tests' }, 'name', 'ASC']],
    distinct: true, // count centres, not joined rows
    ...toOffset({ page, limit }),
  });
  return { rows, count };
}

async function getCentre(id) {
  const centre = await Centre.findByPk(id, {
    include: [availableTests],
    order: [[{ model: Test, as: 'tests' }, 'name', 'ASC']],
  });
  if (!centre) throw notFound('Diagnostic centre');
  return centre;
}

async function createCentre(data) {
  try {
    return await Centre.create(data);
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw conflict('CENTRE_EXISTS', 'A centre with this name already exists in this city');
    throw err;
  }
}

async function setCentreTest(centreId, testId, { price_paise: pricePaise, is_available: isAvailable }) {
  const [centre, test] = await Promise.all([Centre.findByPk(centreId), Test.findByPk(testId)]);
  if (!centre) throw notFound('Diagnostic centre');
  if (!test) throw notFound('Diagnostic test');

  // Insert or update in one statement, relying on the (centre_id, test_id) unique constraint.
  await CentreTest.upsert({ centreId, testId, pricePaise, isAvailable }, { conflictFields: ['centre_id', 'test_id'] });
  return CentreTest.findOne({ where: { centreId, testId } });
}

async function listTests({ page, limit, search }) {
  const whereClause = search ? { name: { [Op.iLike]: `%${search.replace(/[%_\\]/g, '\\$&')}%` } } : {};
  return Test.findAndCountAll({ where: whereClause, order: [['name', 'ASC']], ...toOffset({ page, limit }) });
}

async function createTest({ name, description }) {
  try {
    return await Test.create({ name, description: description || null });
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw conflict('TEST_EXISTS', 'A test with this name already exists');
    throw err;
  }
}

module.exports = { listCentres, getCentre, createCentre, setCentreTest, listTests, createTest };
