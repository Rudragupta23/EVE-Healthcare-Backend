'use strict';

const { badRequest } = require('../utils/errors');

/**
 * Validates req.body / req.query / req.params against Joi schemas.
 * Clean, type-converted values are placed on req.valid so handlers never
 * touch unvalidated input. Unknown fields are rejected, not silently ignored.
 */
const validate = (schemas) => (req, res, next) => {
  req.valid = {};
  const problems = [];

  for (const part of ['params', 'query', 'body']) {
    if (!schemas[part]) continue;
    const { value, error } = schemas[part].validate(req[part] ?? {}, {
      abortEarly: false,
      convert: true,
      stripUnknown: false,
    });
    if (error) {
      problems.push(...error.details.map((d) => ({ in: part, field: d.path.join('.'), message: d.message.replace(/"/g, '') })));
    } else {
      req.valid[part] = value;
    }
  }

  if (problems.length) return next(badRequest('Request validation failed', problems));
  return next();
};

module.exports = validate;
