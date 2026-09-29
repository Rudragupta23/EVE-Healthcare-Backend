'use strict';

const Joi = require('joi');

// Reusable query-string rules for list endpoints.
const paginationQuery = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
};

const toOffset = ({ page, limit }) => ({ limit, offset: (page - 1) * limit });

const paginated = (rows, count, { page, limit }) => ({
  data: rows,
  pagination: { page, limit, total: count, total_pages: Math.ceil(count / limit) },
});

module.exports = { paginationQuery, toOffset, paginated };
