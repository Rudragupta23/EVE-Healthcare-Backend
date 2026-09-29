'use strict';

const Joi = require('joi');
const { paginationQuery } = require('../../utils/pagination');

const uuid = Joi.string().guid();

const listCentres = {
  query: Joi.object({
    ...paginationQuery,
    city: Joi.string().trim().max(100),
    test_id: uuid, // only centres that currently offer this test
  }),
};

const centreIdParam = { params: Joi.object({ id: uuid.required() }) };

const createCentre = {
  body: Joi.object({
    name: Joi.string().trim().min(2).max(150).required(),
    address: Joi.string().trim().min(5).max(255).required(),
    city: Joi.string().trim().min(2).max(100).required(),
  }),
};

// PUT is idempotent: sending the same price twice leaves the same result.
const setCentreTest = {
  params: Joi.object({ id: uuid.required(), testId: uuid.required() }),
  body: Joi.object({
    price_paise: Joi.number().integer().min(1).max(10_000_000).required(), // up to ₹1,00,000
    is_available: Joi.boolean().default(true),
  }),
};

const listTests = { query: Joi.object({ ...paginationQuery, search: Joi.string().trim().max(100) }) };

const createTest = {
  body: Joi.object({
    name: Joi.string().trim().min(2).max(150).required(),
    description: Joi.string().trim().max(2000).allow('', null),
  }),
};

module.exports = { uuid, listCentres, centreIdParam, createCentre, setCentreTest, listTests, createTest };
