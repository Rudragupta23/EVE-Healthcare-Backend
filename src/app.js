'use strict';

const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');
const swaggerUi = require('swagger-ui-express');

const logger = require('./utils/logger');
const { sequelize } = require('./models');
const { apiLimiter } = require('./middleware/rateLimit');
const { errorHandler, notFoundRoute } = require('./middleware/errorHandler');
const openapi = require('./docs/openapi');

const authRoutes = require('./modules/auth/auth.routes');
const { centresRouter, testsRouter } = require('./modules/centres/centres.routes');
const bookingRoutes = require('./modules/bookings/bookings.routes');
const paymentRoutes = require('./modules/payments/payments.routes');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // correct client IPs for rate limiting behind one proxy / load balancer

  // Every request gets an id (or keeps the caller's), which appears in every log line and in the response.
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = req.get('x-request-id') || crypto.randomUUID();
        res.set('X-Request-Id', id);
        return id;
      },
      customLogLevel: (req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    })
  );

  app.use(helmet());
  app.use(cors());
  // Keep the exact raw bytes: webhook signatures are computed over them, not over re-serialised JSON.
  app.use(express.json({ limit: '100kb', verify: (req, res, buf) => { req.rawBody = buf; } }));

  app.get('/health', async (req, res) => {
    try {
      await sequelize.authenticate();
      res.json({ status: 'ok', database: 'up' });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'down' });
    }
  });

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));
  app.get('/openapi.json', (req, res) => res.json(openapi));

  app.use(apiLimiter);
  app.use('/auth', authRoutes);
  app.use('/centres', centresRouter);
  app.use('/tests', testsRouter);
  app.use('/bookings', bookingRoutes);
  app.use('/payments', paymentRoutes);

  app.use(notFoundRoute);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
