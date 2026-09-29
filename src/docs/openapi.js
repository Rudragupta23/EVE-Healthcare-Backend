'use strict';

// OpenAPI 3 description served at /docs (Swagger UI) and /openapi.json.

const uuid = { type: 'string', format: 'uuid' };
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ 'application/json': { schema } });
const errorResponse = (description) => ({ description, content: json(ref('Error')) });
const bearer = [{ bearerAuth: [] }];
const idParam = (name = 'id') => ({ name, in: 'path', required: true, schema: uuid });
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
];
const common = { 400: errorResponse('Validation error'), 429: errorResponse('Rate limited') };
const authed = { ...common, 401: errorResponse('Missing / invalid token') };

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'EVE Healthcare — Diagnostic Booking API',
    version: '1.0.0',
    description:
      'Book diagnostic tests and pay through a simulated gateway. Money is in integer paise (₹450.00 = 45000). ' +
      'Log in via /auth/login, then click "Authorize" and paste the access_token.',
  },
  servers: [{ url: '/' }],
  tags: [{ name: 'Auth' }, { name: 'Centres & Tests' }, { name: 'Bookings' }, { name: 'Payments' }, { name: 'System' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string' },
              details: {},
            },
          },
        },
      },
      Pagination: {
        type: 'object',
        properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, total_pages: { type: 'integer' } },
      },
      User: {
        type: 'object',
        properties: { id: uuid, name: { type: 'string' }, email: { type: 'string' }, role: { type: 'string', enum: ['USER', 'ADMIN'] }, created_at: { type: 'string', format: 'date-time' } },
      },
      AuthResponse: {
        type: 'object',
        properties: { user: ref('User'), access_token: { type: 'string' }, token_type: { type: 'string', example: 'Bearer' }, expires_in: { type: 'string', example: '1h' } },
      },
      Test: { type: 'object', properties: { id: uuid, name: { type: 'string' }, description: { type: 'string', nullable: true } } },
      Centre: {
        type: 'object',
        properties: {
          id: uuid,
          name: { type: 'string' },
          address: { type: 'string' },
          city: { type: 'string' },
          tests: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: uuid, name: { type: 'string' }, description: { type: 'string', nullable: true }, price_paise: { type: 'integer', example: 45000 }, is_available: { type: 'boolean' } },
            },
          },
        },
      },
      Payment: {
        type: 'object',
        properties: {
          id: uuid,
          booking_id: uuid,
          amount_paise: { type: 'integer' },
          currency: { type: 'string', example: 'INR' },
          status: { type: 'string', enum: ['PENDING', 'SUCCESS', 'FAILED'] },
          provider_ref: { type: 'string', example: 'pay_mock_3f2a...' },
          failure_reason: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      Booking: {
        type: 'object',
        properties: {
          id: uuid,
          user_id: uuid,
          centre: { type: 'object', properties: { id: uuid, name: { type: 'string' }, city: { type: 'string' } } },
          test: { type: 'object', properties: { id: uuid, name: { type: 'string' } } },
          appointment_at: { type: 'string', format: 'date-time' },
          amount_paise: { type: 'integer' },
          currency: { type: 'string' },
          status: { type: 'string', enum: ['PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED'] },
          payment: { allOf: [ref('Payment')], nullable: true },
          cancelled_at: { type: 'string', format: 'date-time', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  paths: {
    '/health': { get: { tags: ['System'], summary: 'Liveness + database check', responses: { 200: { description: 'OK' }, 503: { description: 'Database down' } } } },

    '/auth/signup': {
      post: {
        tags: ['Auth'],
        summary: 'Create an account (always role USER)',
        requestBody: {
          required: true,
          content: json({ type: 'object', required: ['name', 'email', 'password'], properties: { name: { type: 'string', example: 'Asha Verma' }, email: { type: 'string', example: 'asha@example.com' }, password: { type: 'string', example: 'Secret123', description: 'min 8 chars, a letter and a number' } } }),
        },
        responses: { 201: { description: 'Created', content: json(ref('AuthResponse')) }, 409: errorResponse('Email already registered'), ...common },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in and get a JWT',
        requestBody: { required: true, content: json({ type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } }) },
        responses: { 200: { description: 'OK', content: json(ref('AuthResponse')) }, 401: errorResponse('Wrong email or password'), ...common },
      },
    },
    '/auth/me': { get: { tags: ['Auth'], summary: 'Current user', security: bearer, responses: { 200: { description: 'OK' }, ...authed } } },

    '/centres': {
      get: {
        tags: ['Centres & Tests'],
        summary: 'List centres with the tests they offer and prices (public)',
        parameters: [...pageParams, { name: 'city', in: 'query', schema: { type: 'string' } }, { name: 'test_id', in: 'query', schema: uuid, description: 'Only centres offering this test' }],
        responses: { 200: { description: 'OK', content: json({ type: 'object', properties: { data: { type: 'array', items: ref('Centre') }, pagination: ref('Pagination') } }) }, ...common },
      },
      post: {
        tags: ['Centres & Tests'],
        summary: 'Create a centre (admin)',
        security: bearer,
        requestBody: { required: true, content: json({ type: 'object', required: ['name', 'address', 'city'], properties: { name: { type: 'string' }, address: { type: 'string' }, city: { type: 'string' } } }) },
        responses: { 201: { description: 'Created', content: json(ref('Centre')) }, 403: errorResponse('Not an admin'), 409: errorResponse('Duplicate'), ...authed },
      },
    },
    '/centres/{id}': {
      get: { tags: ['Centres & Tests'], summary: 'One centre with its tests and prices', parameters: [idParam()], responses: { 200: { description: 'OK', content: json(ref('Centre')) }, 404: errorResponse('Not found'), ...common } },
    },
    '/centres/{id}/tests/{testId}': {
      put: {
        tags: ['Centres & Tests'],
        summary: 'Offer a test at a centre / change its price (admin, idempotent)',
        security: bearer,
        parameters: [idParam(), idParam('testId')],
        requestBody: { required: true, content: json({ type: 'object', required: ['price_paise'], properties: { price_paise: { type: 'integer', example: 45000 }, is_available: { type: 'boolean', default: true } } }) },
        responses: { 200: { description: 'OK' }, 403: errorResponse('Not an admin'), 404: errorResponse('Centre or test not found'), ...authed },
      },
    },
    '/tests': {
      get: { tags: ['Centres & Tests'], summary: 'Test catalogue (public)', parameters: [...pageParams, { name: 'search', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'OK' }, ...common } },
      post: {
        tags: ['Centres & Tests'],
        summary: 'Add a test to the catalogue (admin)',
        security: bearer,
        requestBody: { required: true, content: json({ type: 'object', required: ['name'], properties: { name: { type: 'string' }, description: { type: 'string' } } }) },
        responses: { 201: { description: 'Created', content: json(ref('Test')) }, 403: errorResponse('Not an admin'), 409: errorResponse('Duplicate'), ...authed },
      },
    },

    '/bookings': {
      post: {
        tags: ['Bookings'],
        summary: 'Book a test (status starts as PENDING; price is taken from the centre)',
        security: bearer,
        requestBody: {
          required: true,
          content: json({ type: 'object', required: ['centre_id', 'test_id', 'appointment_at'], properties: { centre_id: uuid, test_id: uuid, appointment_at: { type: 'string', format: 'date-time', example: '2026-10-05T10:30:00+05:30', description: 'Future, within 90 days, timezone required' } } }),
        },
        responses: { 201: { description: 'Created', content: json(ref('Booking')) }, 404: errorResponse('Centre not found'), 409: errorResponse('DUPLICATE_BOOKING'), 422: errorResponse('TEST_NOT_OFFERED'), ...authed },
      },
      get: {
        tags: ['Bookings'],
        summary: 'My bookings (admins see all)',
        security: bearer,
        parameters: [...pageParams, { name: 'status', in: 'query', schema: { type: 'string', enum: ['PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED'] } }],
        responses: { 200: { description: 'OK' }, ...authed },
      },
    },
    '/bookings/{id}': {
      get: { tags: ['Bookings'], summary: 'One booking (404 if it is not yours)', security: bearer, parameters: [idParam()], responses: { 200: { description: 'OK', content: json(ref('Booking')) }, 404: errorResponse('Not found'), ...authed } },
    },
    '/bookings/{id}/cancel': {
      post: {
        tags: ['Bookings'],
        summary: 'Cancel a PENDING booking (repeat calls are safe)',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Cancelled', content: json(ref('Booking')) }, 404: errorResponse('Not found'), 409: errorResponse('INVALID_STATE_TRANSITION / PAYMENT_IN_PROGRESS'), ...authed },
      },
    },

    '/payments/': {
      post: {
        tags: ['Payments'],
        summary: 'Pay for a booking with the simulated gateway',
        description: 'SUCCESS confirms the booking, FAILED fails it, PENDING waits for the webhook. Send an Idempotency-Key header to make retries safe.',
        security: bearer,
        parameters: [{ name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', example: 'pay-8c1f2a90' } }],
        requestBody: { required: true, content: json({ type: 'object', required: ['booking_id'], properties: { booking_id: uuid, simulate_outcome: { type: 'string', enum: ['SUCCESS', 'FAILED', 'PENDING'], default: 'SUCCESS' } } }) },
        responses: {
          201: { description: 'Payment created', content: json({ type: 'object', properties: { payment: ref('Payment'), booking_status: { type: 'string' } } }) },
          200: { description: 'Idempotent replay of an earlier request (header Idempotent-Replayed: true)' },
          404: errorResponse('Booking not found'),
          409: errorResponse('PAYMENT_ALREADY_EXISTS / BOOKING_NOT_PAYABLE'),
          422: errorResponse('IDEMPOTENCY_KEY_REUSED / APPOINTMENT_IN_PAST'),
          ...authed,
        },
      },
    },
    '/payments/{id}': {
      get: { tags: ['Payments'], summary: 'One payment (404 if it is not yours)', security: bearer, parameters: [idParam()], responses: { 200: { description: 'OK', content: json(ref('Payment')) }, 404: errorResponse('Not found'), ...authed } },
    },
    '/payments/webhook/': {
      post: {
        tags: ['Payments'],
        summary: 'Payment status update from the provider (idempotent)',
        description:
          'Authenticated by header X-Webhook-Signature: sha256=<hex HMAC-SHA256 of the raw body with WEBHOOK_SECRET>. ' +
          'The same event_id can be delivered any number of times; it is applied once. Use `npm run webhook` to send a signed test event.',
        parameters: [{ name: 'X-Webhook-Signature', in: 'header', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['event_id', 'type', 'data'],
            properties: {
              event_id: { type: 'string', example: 'evt_001' },
              type: { type: 'string', enum: ['payment.succeeded', 'payment.failed'] },
              data: { type: 'object', required: ['provider_ref', 'amount_paise'], properties: { provider_ref: { type: 'string' }, amount_paise: { type: 'integer' }, failure_reason: { type: 'string' } } },
            },
          }),
        },
        responses: {
          200: {
            description: 'Accepted',
            content: json({ type: 'object', properties: { received: { type: 'boolean' }, event_id: { type: 'string' }, duplicate: { type: 'boolean' }, outcome: { type: 'string', enum: ['APPLIED', 'NO_CHANGE', 'STATUS_CONFLICT', 'AMOUNT_MISMATCH'] }, attempts: { type: 'integer' } } }),
          },
          401: errorResponse('Bad signature'),
          404: errorResponse('Unknown provider_ref'),
          409: errorResponse('EVENT_ID_REUSED with a different payload'),
          500: errorResponse('Processing failed; safe for the provider to retry'),
          400: errorResponse('Validation error'),
        },
      },
    },
  },
};
