'use strict';

const { UniqueConstraintError, ForeignKeyConstraintError } = require('sequelize');
const { AppError } = require('../utils/errors');

const send = (res, status, code, message, details) =>
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });

function notFoundRoute(req, res) {
  return send(res, 404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`);
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) return send(res, err.status, err.code, err.message, err.details);

  // Malformed JSON body, or body too big (thrown by express.json()).
  if (err.type === 'entity.parse.failed') return send(res, 400, 'INVALID_JSON', 'Request body is not valid JSON');
  if (err.type === 'entity.too.large') return send(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');

  // A database rule caught something the service layer did not (e.g. a race between two requests).
  if (err instanceof UniqueConstraintError) return send(res, 409, 'CONFLICT', 'This record already exists');
  if (err instanceof ForeignKeyConstraintError) return send(res, 422, 'INVALID_REFERENCE', 'A referenced record does not exist');

  // Anything else is a bug: log the details, never leak them to the client.
  (req.log || console).error({ err }, 'Unhandled error');
  return send(res, 500, 'INTERNAL_ERROR', 'Something went wrong');
}

module.exports = { errorHandler, notFoundRoute };
