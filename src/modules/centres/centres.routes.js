'use strict';

const { Router } = require('express');
const validate = require('../../middleware/validate');
const { authenticate, requireRole } = require('../../middleware/auth');
const { paginated } = require('../../utils/pagination');
const { ROLES } = require('../../utils/constants');
const serialize = require('../../utils/serializers');
const schemas = require('./centres.schemas');
const service = require('./centres.service');

const adminOnly = [authenticate, requireRole(ROLES.ADMIN)];

// ---- /centres ----
const centres = Router();

// Browsing centres and prices is public, like any booking site.
centres.get('/', validate(schemas.listCentres), async (req, res) => {
  const { rows, count } = await service.listCentres(req.valid.query);
  res.json(paginated(rows.map(serialize.centre), count, req.valid.query));
});

centres.get('/:id', validate(schemas.centreIdParam), async (req, res) => {
  res.json(serialize.centre(await service.getCentre(req.valid.params.id)));
});

centres.post('/', adminOnly, validate(schemas.createCentre), async (req, res) => {
  res.status(201).json(serialize.centre(await service.createCentre(req.valid.body)));
});

centres.put('/:id/tests/:testId', adminOnly, validate(schemas.setCentreTest), async (req, res) => {
  const ct = await service.setCentreTest(req.valid.params.id, req.valid.params.testId, req.valid.body);
  res.json({ centre_id: ct.centreId, test_id: ct.testId, price_paise: ct.pricePaise, is_available: ct.isAvailable });
});

// ---- /tests (the catalogue) ----
const tests = Router();

tests.get('/', validate(schemas.listTests), async (req, res) => {
  const { rows, count } = await service.listTests(req.valid.query);
  res.json(paginated(rows.map(serialize.test), count, req.valid.query));
});

tests.post('/', adminOnly, validate(schemas.createTest), async (req, res) => {
  res.status(201).json(serialize.test(await service.createTest(req.valid.body)));
});

module.exports = { centresRouter: centres, testsRouter: tests };
