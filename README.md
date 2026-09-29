# EVE Healthcare — Diagnostic Test Booking API

A small backend where patients book diagnostic tests (blood tests, X-rays, …) at a centre and pay through a **simulated** payment gateway. The payment provider reports results through a **signed, idempotent webhook**.

**Stack:** Node.js 20+ · Express 5 · PostgreSQL 16 · Sequelize (ORM) · Umzug (migrations) · JWT · Joi (validation) · Pino (structured logs) · Jest + Supertest (tests) · Swagger UI · Docker.

> The brief suggests Python frameworks but allows "another backend framework you are comfortable with". I built it in Node.js/Express, which is the stack I use day to day. `package.json` + `package-lock.json` play the role of `requirements.txt`.

**Status:** 81 automated tests (unit + integration against a real PostgreSQL), ~96% line coverage.

---

## Contents
1. [Run it with Docker](#1-run-it-with-docker-easiest)
2. [Run it locally without Docker](#2-run-it-locally-without-docker)
3. [The `.env` file](#3-the-env-file)
4. [Run the tests](#4-run-the-tests)
5. [Try the full flow](#5-try-the-full-flow)
6. [API endpoints](#6-api-endpoints)
7. [Database design](#7-database-design)
8. [How the important parts work](#8-how-the-important-parts-work)
9. [Edge cases handled](#9-edge-cases-handled)
10. [Assumptions](#10-assumptions)
11. [What I would improve with more time](#11-what-i-would-improve-with-more-time)
12. [Project structure](#12-project-structure)

---

## 1. Run it with Docker (easiest)

Needs Docker Desktop.

```bash
cp .env.example .env          # Windows (cmd): copy .env.example .env
docker compose up --build
```

That starts PostgreSQL and the API, applies the migrations and loads sample data.

- API: http://localhost:3000
- Interactive docs (Swagger): http://localhost:3000/docs
- Health check: http://localhost:3000/health

PostgreSQL is published on port **5433** on your machine, so it will not clash with a PostgreSQL you may already have installed.

## 2. Run it locally without Docker

Needs **Node.js 20+** and **PostgreSQL 13+**.

```bash
npm install

# create the two databases (or create them in pgAdmin)
psql -U postgres -c "CREATE DATABASE eve_healthcare;"
psql -U postgres -c "CREATE DATABASE eve_healthcare_test;"

cp .env.example .env          # then edit it, see section 3
npm run setup                 # runs the migrations and loads sample data
npm run dev                   # starts on http://localhost:3000 with readable logs
```

Other scripts: `npm start` (production mode, JSON logs), `npm run migrate`, `npm run migrate:down`, `npm run seed`, `npm test`, `npm run test:coverage`, `npm run webhook` (see section 5).

## 3. The `.env` file

Put `.env` in the **project root** — the same folder as `package.json`. The app checks every value when it starts and refuses to start, listing what is wrong, if something is missing or invalid.

| Variable | What to put | Where to get it |
|---|---|---|
| `DATABASE_URL` | `postgres://USER:PASSWORD@localhost:5432/eve_healthcare` | Your PostgreSQL username/password (often `postgres` / what you chose when installing). Ignored when using Docker. |
| `TEST_DATABASE_URL` | same, but ending in `/eve_healthcare_test` | Used only by `npm test`. **Its data is wiped on every test run.** The tests refuse to run unless the name contains `test`. |
| `JWT_SECRET` | a random string, at least 32 characters | Run `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and paste the output |
| `WEBHOOK_SECRET` | another random string (16+ characters) | Same command, run it again |
| `JWT_EXPIRES_IN` | `1h` | How long a login token lasts |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | e.g. `admin@eve.local` / `Admin@12345` | The admin account created by `npm run seed` |
| `PORT`, `LOG_LEVEL`, `RATE_LIMIT_*` | leave the defaults | |

## 4. Run the tests

```bash
npm test                  # or: npm run test:coverage
```

The tests run against a **real PostgreSQL** database (the one in `TEST_DATABASE_URL`), not mocks, because the most important guarantees — unique constraints, row locks, transactions — only exist in the database. Before the run the schema is rebuilt from the migrations; each test starts from empty tables.

With Docker, the test database is created for you. Start only the database and point the tests at port 5433:

```bash
docker compose up -d db
# in .env:  TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/eve_healthcare_test
npm test
```

What is covered: signup/login/JWT failures, admin-only routes, pagination and filters, every booking validation rule, the booking state machine, all three payment outcomes, `Idempotency-Key` replay, **10 simultaneous payment requests creating exactly one payment**, webhook signatures, **10 simultaneous copies of the same webhook being applied exactly once**, conflicting and mismatched webhooks, and a webhook that crashes half-way and succeeds on retry.

## 5. Try the full flow

Easiest: open **http://localhost:3000/docs**, call `/auth/signup`, click **Authorize** and paste the `access_token`.

Or with `curl` (bash / Git Bash):

```bash
# 1. Sign up and keep the token
TOKEN=$(curl -s -X POST localhost:3000/auth/signup -H 'Content-Type: application/json' \
  -d '{"name":"Asha Verma","email":"asha@example.com","password":"Secret123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')

# 2. Browse centres, their tests and prices (public, paginated)
curl -s 'localhost:3000/centres?city=Bhopal&page=1&limit=10'

# 3. Book a test (use a centre id and test id from step 2; time must include a timezone)
curl -s -X POST localhost:3000/bookings -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"centre_id":"<centre id>","test_id":"<test id>","appointment_at":"2026-10-05T10:30:00+05:30"}'
# -> 201, "status":"PENDING", "amount_paise":35000   (price comes from the database)

# 4a. Pay — instant result. simulate_outcome: SUCCESS (default) | FAILED | PENDING
curl -s -X POST localhost:3000/payments/ -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: checkout-0001' -d '{"booking_id":"<booking id>","simulate_outcome":"SUCCESS"}'
# -> 201 {"payment":{"status":"SUCCESS",...},"booking_status":"CONFIRMED"}
# Same request again with the same Idempotency-Key -> 200, same payment, header Idempotent-Replayed: true

# 4b. Or pay with PENDING, then play the provider and send the webhook yourself:
npm run webhook -- <provider_ref from the payment> SUCCESS 35000 evt_001
# -> {"received":true,"duplicate":false,"outcome":"APPLIED"}   booking is now CONFIRMED
npm run webhook -- <provider_ref> SUCCESS 35000 evt_001
# -> {"received":true,"duplicate":true,"outcome":"APPLIED"}    nothing changes the second time
```

`npm run webhook` signs the body with your `WEBHOOK_SECRET`, exactly like a real provider would.

**Money** is always an integer number of **paise** (₹350.00 = `35000`) to avoid rounding errors.

**Errors** always look the same:

```json
{ "error": { "code": "DUPLICATE_BOOKING", "message": "You already have an active booking for this test, centre and time" } }
```

Validation errors add `details` with the field names. Every response has an `X-Request-Id` header that also appears in every log line for that request.

## 6. API endpoints

| Method & path | Auth | What it does |
|---|---|---|
| `POST /auth/signup` | – | Create an account (always role `USER`) → token |
| `POST /auth/login` | – | Log in → JWT (`Bearer`) |
| `GET /auth/me` | user | Current user |
| `GET /centres` | – | Centres with available tests and prices. `?city=` `?test_id=` `?page=` `?limit=` |
| `GET /centres/:id` | – | One centre with its tests and prices |
| `POST /centres` | admin | Create a centre |
| `PUT /centres/:id/tests/:testId` | admin | Offer a test at a centre / change its price (idempotent) |
| `GET /tests` | – | Test catalogue. `?search=` + pagination |
| `POST /tests` | admin | Add a test to the catalogue |
| `POST /bookings` | user | Book a test → `PENDING` |
| `GET /bookings` | user | My bookings (admins: all). `?status=` + pagination |
| `GET /bookings/:id` | user | One booking with its payment |
| `POST /bookings/:id/cancel` | user | Cancel a `PENDING` booking (repeat calls are safe) |
| `POST /payments/` | user | Pay for a booking with the simulated gateway. Optional `Idempotency-Key` header |
| `GET /payments/:id` | user | One payment |
| `POST /payments/webhook/` | signature | Payment result from the provider (idempotent) |
| `GET /health` | – | API + database status |
| `GET /docs`, `GET /openapi.json` | – | Swagger UI / OpenAPI 3 spec |

Browsing centres is public, like any booking website. Logging in is only needed to book and pay.

## 7. Database design

```mermaid
erDiagram
  users ||--o{ bookings : makes
  diagnostic_centres ||--o{ centre_tests : offers
  diagnostic_tests ||--o{ centre_tests : "offered at"
  diagnostic_centres ||--o{ bookings : at
  diagnostic_tests ||--o{ bookings : for
  bookings ||--o| payments : "paid by"
  payments ||--o{ webhook_events : "reported by (provider_ref)"

  users {
    uuid id PK
    varchar email "unique, case-insensitive"
    varchar password_hash
    user_role role
  }
  diagnostic_centres {
    uuid id PK
    varchar name
    varchar address
    varchar city
  }
  diagnostic_tests {
    uuid id PK
    varchar name "unique, case-insensitive"
    text description
  }
  centre_tests {
    uuid id PK
    uuid centre_id FK
    uuid test_id FK
    int price_paise
    bool is_available
  }
  bookings {
    uuid id PK
    uuid user_id FK
    uuid centre_id FK
    uuid test_id FK
    timestamptz appointment_at
    int amount_paise
    booking_status status
  }
  payments {
    uuid id PK
    uuid booking_id FK "unique"
    int amount_paise
    payment_status status
    varchar provider_ref "unique"
    varchar idempotency_key
  }
  webhook_events {
    uuid id PK
    varchar event_id "unique"
    varchar provider_ref
    char payload_hash
    jsonb payload
    varchar outcome
    int attempts
  }
```

Design choices, and why:

- **Price lives on `centre_tests`, not on the test.** The same test costs different amounts at different centres. A centre–test pair can exist only once.
- **`bookings.amount_paise` is a copy of the price at booking time.** If an admin changes a price later, existing bookings keep the price the patient agreed to.
- **Important rules are enforced by PostgreSQL itself**, so they hold even if two requests race or the code has a bug:
  - `payments.booking_id` is `UNIQUE` → a booking can never be charged twice.
  - `webhook_events.event_id` is `UNIQUE` → a webhook event can never be stored or applied twice.
  - Partial unique index on `bookings (user_id, centre_id, test_id, appointment_at) WHERE status IN ('PENDING','CONFIRMED')` → no duplicate live bookings (for example from a double-clicked button). Cancelled or failed bookings do not block rebooking.
  - `CHECK (price_paise > 0)`, `CHECK (amount_paise > 0)`, PostgreSQL `ENUM`s for every status, foreign keys everywhere.
- **UUID primary keys**, so ids cannot be guessed by counting (`/bookings/1`, `/bookings/2` …).
- **`timestamptz`** for every time, so time zones are never ambiguous.
- **Migrations** (`src/db/migrations`) own the schema; the app never calls `sequelize.sync()`. The migration is plain SQL so the rules above are easy to read.
- Indexes match the queries: bookings by user and date, centres by city, events by `provider_ref`.

## 8. How the important parts work

### Booking states

```
PENDING ──payment SUCCESS──▶ CONFIRMED
   │  └──payment FAILED───▶ FAILED
   └──── user cancels ────▶ CANCELLED
```

All allowed moves are in one small file (`bookingStateMachine.js`); every status change goes through it.

### Payments (`POST /payments/`)

1. Lock the booking row (`SELECT … FOR UPDATE`). Any other payment or cancel request for the same booking waits.
2. If an `Idempotency-Key` was sent and already used by this user, return the original payment (`200`, `Idempotent-Replayed: true`). The check happens *after* taking the lock, so two identical requests sent at the same moment are handled one after the other, and the second sees the first one's result.
3. Refuse if the booking already has a payment, is not `PENDING`, or the appointment has passed.
4. Create the payment (amount from the booking, never from the client) and ask the mock gateway. `SUCCESS`/`FAILED` are applied at once; `PENDING` waits for the webhook.

### Webhook (`POST /payments/webhook/`)

1. **Signature check.** `X-Webhook-Signature: sha256=<HMAC-SHA256 of the raw body with WEBHOOK_SECRET>`, compared in constant time. The raw request bytes are kept for this, because re-serialised JSON may differ.
2. **Store the event once**: `INSERT … ON CONFLICT (event_id) DO NOTHING`, then lock that row.
   - Already `PROCESSED` → reply `duplicate: true` and do nothing.
   - Same `event_id` but a different body → `409 EVENT_ID_REUSED`. (Bodies are compared by a hash of key-sorted JSON, so the same event with its keys in another order still counts as the same.)
3. **Apply the result in the same transaction** as marking the event processed, so there is never an event marked "done" whose change was not saved (or the other way round).
4. **Never go backwards.** A payment that is already final is never overwritten: a late `payment.failed` after a success is recorded as `STATUS_CONFLICT` and ignored. An event whose amount does not match is recorded as `AMOUNT_MISMATCH` and not applied.
5. **Retries.** If processing crashes, the transaction rolls back (nothing half-applied), the event is saved as `FAILED` with the error and attempt count, and the API returns `500`. The provider retries, and the retry processes it normally.

Both the instant result and the webhook use the **same function** (`applyProviderResult`) to change a payment, so the two paths can never disagree.

**No deadlocks:** every code path locks the booking first and the payment second.

## 9. Edge cases handled

| Situation | Result |
|---|---|
| Invalid body, unknown fields (e.g. client sends `amount_paise` or `role`), bad UUIDs, bad JSON | `400` with the fields listed |
| Appointment in the past, >90 days ahead, or without a timezone | `400` |
| Centre does not exist / does not offer the test / test switched off | `404` / `422 TEST_NOT_OFFERED` |
| Same user books the same slot twice (even at the same moment) | `409 DUPLICATE_BOOKING` |
| Someone else's booking or payment, by id | `404` (not `403`, so ids cannot be probed) |
| Normal user calls an admin route | `403` |
| Missing, invalid, expired token, or token of a deleted user | `401` |
| Paying twice / 10 payments at once | exactly one payment; others `409 PAYMENT_ALREADY_EXISTS` |
| Retried payment request with the same `Idempotency-Key` | original result returned, nothing new created |
| Same key used for a different booking | `422 IDEMPOTENCY_KEY_REUSED` |
| Paying for a cancelled/failed/confirmed booking | `409 BOOKING_NOT_PAYABLE` |
| Paying after the appointment time | `422 APPOINTMENT_IN_PAST` |
| Failed payment | payment `FAILED` with a reason, booking `FAILED` |
| Cancelling while a payment is still pending | `409 PAYMENT_IN_PROGRESS` |
| Cancelling a confirmed booking / cancelling twice | `409` / `200` (no change) |
| Webhook: bad signature / unknown `provider_ref` | `401` / `404`, nothing stored |
| Webhook: repeated event, or 10 copies at once | applied once, the rest reply `duplicate: true` |
| Webhook: event id reused with a different body | `409 EVENT_ID_REUSED` |
| Webhook: conflicting final status or wrong amount | acknowledged, not applied, logged |
| Webhook: crash during processing | rolled back, recorded as `FAILED`, retry succeeds |
| Too many requests | `429` (stricter limit on signup/login) |

## 10. Assumptions

- **One payment per booking.** A failed payment makes the booking `FAILED`; the patient simply books again. This keeps the money rules simple and lets the database guarantee "no double charge".
- **Confirmed bookings cannot be cancelled here**, because that needs a refund flow, which is out of scope.
- **A centre has unlimited capacity per time slot.** Different users can book the same slot; only the *same* user is stopped from duplicating a booking.
- **Browsing centres and tests is public**; booking and paying need login. Only admins manage centres, tests and prices. Everyone who signs up is a normal user; the admin comes from the seed script.
- **The mock gateway's result is chosen by the caller** (`simulate_outcome`) so every path can be tested on demand. It answers instantly, so it runs inside the database transaction. With a real gateway the network call would happen outside the transaction.
- **Webhooks are authenticated by an HMAC signature**, not a JWT, because the caller is the payment provider, not a user.
- A webhook with a wrong amount or a conflicting status is **acknowledged with `200`** (so the provider stops retrying) but not applied, and is logged for a person to review.
- All amounts are in INR paise.

## 11. What I would improve with more time

- **Background jobs:** automatically fail `PENDING` bookings whose payment never gets a webhook (e.g. after 30 minutes) and ask the provider for the status; send booking confirmation emails.
- **Slot capacity and centre opening hours**, so a slot is not overbooked across users.
- **Refunds**, so confirmed bookings can be cancelled; and allowing a new payment attempt on the same booking after a failure (a partial unique index "one `SUCCESS` payment per booking" would keep it safe).
- **Redis** for the rate limiter and for caching the public centre list (needed once there is more than one API instance).
- **Refresh tokens** and logout / token revoke; timestamped webhook signatures to reject very old replays.
- An **outbox table** for reliable event publishing, and metrics/tracing (OpenTelemetry).
- CI pipeline (lint + tests on every push) and ESLint/Prettier.

## 12. Project structure

```
src/
  app.js                    Express app: middleware, routes, errors
  server.js                 Starts the server, graceful shutdown
  config/index.js           Reads and validates .env (fails fast)
  db/                       Sequelize connection, migration runner, migrations, seed data
  models/index.js           Table definitions and relations
  middleware/               auth (JWT + roles), validate (Joi), rate limit, error handler
  modules/
    auth/                   signup, login, me
    centres/                centres, tests catalogue, prices
    bookings/               booking service + state machine
    payments/               payments, mock gateway, webhook service
  utils/                    errors, pagination, serializers, signatures, constants, logger
  docs/openapi.js           Swagger / OpenAPI spec
scripts/send-webhook.js     Sends a signed test webhook (npm run webhook)
tests/unit, tests/integration
Dockerfile, docker-compose.yml
```

Each module follows the same pattern: **routes** (HTTP only) → **service** (business rules, transactions) → **models**. Request rules live in each module's `*.schemas.js`.
