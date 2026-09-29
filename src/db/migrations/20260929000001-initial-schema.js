'use strict';

/**
 * Initial schema.
 *
 * Written as plain SQL on purpose: the important rules (unique indexes, CHECK
 * constraints, partial indexes) are easy to read here and are enforced by
 * PostgreSQL itself, so they hold even if application code has a bug.
 */
module.exports = {
  async up({ queryInterface }) {
    const sql = (q) => queryInterface.sequelize.query(q);

    // gen_random_uuid() is built in from PostgreSQL 13. pgcrypto keeps older versions working.
    await sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    await sql(`CREATE TYPE user_role AS ENUM ('USER', 'ADMIN');`);
    await sql(`CREATE TYPE booking_status AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED');`);
    await sql(`CREATE TYPE payment_status AS ENUM ('PENDING', 'SUCCESS', 'FAILED');`);
    await sql(`CREATE TYPE webhook_event_status AS ENUM ('PROCESSING', 'PROCESSED', 'FAILED');`);

    // ---------- users ----------
    await sql(`
      CREATE TABLE users (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name          varchar(100) NOT NULL,
        email         varchar(255) NOT NULL,
        password_hash varchar(255) NOT NULL,
        role          user_role    NOT NULL DEFAULT 'USER',
        created_at    timestamptz  NOT NULL DEFAULT now(),
        updated_at    timestamptz  NOT NULL DEFAULT now()
      );
    `);
    // Case-insensitive uniqueness: "A@x.com" and "a@x.com" are the same account.
    await sql(`CREATE UNIQUE INDEX users_email_unique ON users (lower(email));`);

    // ---------- diagnostic centres ----------
    await sql(`
      CREATE TABLE diagnostic_centres (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name       varchar(150) NOT NULL,
        address    varchar(255) NOT NULL,
        city       varchar(100) NOT NULL,
        created_at timestamptz  NOT NULL DEFAULT now(),
        updated_at timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT diagnostic_centres_name_city_unique UNIQUE (name, city)
      );
    `);
    await sql(`CREATE INDEX diagnostic_centres_city_idx ON diagnostic_centres (lower(city));`);

    // ---------- diagnostic tests (the catalogue, e.g. "Complete Blood Count") ----------
    await sql(`
      CREATE TABLE diagnostic_tests (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name        varchar(150) NOT NULL,
        description text,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
    `);
    await sql(`CREATE UNIQUE INDEX diagnostic_tests_name_unique ON diagnostic_tests (lower(name));`);

    // ---------- centre_tests: which centre offers which test, and at what price ----------
    // Price lives here (not on the test) because the same test costs different amounts at different centres.
    await sql(`
      CREATE TABLE centre_tests (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        centre_id    uuid    NOT NULL REFERENCES diagnostic_centres(id) ON DELETE CASCADE,
        test_id      uuid    NOT NULL REFERENCES diagnostic_tests(id)   ON DELETE RESTRICT,
        price_paise  integer NOT NULL CHECK (price_paise > 0),
        is_available boolean NOT NULL DEFAULT true,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT centre_tests_centre_test_unique UNIQUE (centre_id, test_id)
      );
    `);
    await sql(`CREATE INDEX centre_tests_test_idx ON centre_tests (test_id);`);

    // ---------- bookings ----------
    // amount_paise is a snapshot of the price at booking time, so later price changes
    // never alter what the patient agreed to pay.
    await sql(`
      CREATE TABLE bookings (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        uuid           NOT NULL REFERENCES users(id)              ON DELETE RESTRICT,
        centre_id      uuid           NOT NULL REFERENCES diagnostic_centres(id) ON DELETE RESTRICT,
        test_id        uuid           NOT NULL REFERENCES diagnostic_tests(id)   ON DELETE RESTRICT,
        appointment_at timestamptz    NOT NULL,
        amount_paise   integer        NOT NULL CHECK (amount_paise > 0),
        currency       char(3)        NOT NULL DEFAULT 'INR',
        status         booking_status NOT NULL DEFAULT 'PENDING',
        cancelled_at   timestamptz,
        created_at     timestamptz    NOT NULL DEFAULT now(),
        updated_at     timestamptz    NOT NULL DEFAULT now()
      );
    `);
    await sql(`CREATE INDEX bookings_user_created_idx ON bookings (user_id, created_at DESC);`);
    // Stops the same user holding two live bookings for the same test, centre and time
    // (e.g. a double-clicked "Book" button). Failed and cancelled bookings do not count.
    await sql(`
      CREATE UNIQUE INDEX bookings_no_duplicate_active
        ON bookings (user_id, centre_id, test_id, appointment_at)
        WHERE status IN ('PENDING', 'CONFIRMED');
    `);

    // ---------- payments ----------
    await sql(`
      CREATE TABLE payments (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id      uuid           NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
        user_id         uuid           NOT NULL REFERENCES users(id)    ON DELETE RESTRICT,
        amount_paise    integer        NOT NULL CHECK (amount_paise > 0),
        currency        char(3)        NOT NULL DEFAULT 'INR',
        status          payment_status NOT NULL DEFAULT 'PENDING',
        provider_ref    varchar(64)    NOT NULL,
        idempotency_key varchar(128),
        failure_reason  varchar(255),
        created_at      timestamptz    NOT NULL DEFAULT now(),
        updated_at      timestamptz    NOT NULL DEFAULT now(),
        CONSTRAINT payments_provider_ref_unique UNIQUE (provider_ref),
        -- One payment per booking: the database itself makes a double charge impossible.
        CONSTRAINT payments_booking_unique      UNIQUE (booking_id),
        CONSTRAINT payments_idempotency_unique  UNIQUE (user_id, idempotency_key)
      );
    `);

    // ---------- webhook_events: every webhook we accepted, keyed by the provider's event id ----------
    await sql(`
      CREATE TABLE webhook_events (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id        varchar(128)         NOT NULL,
        event_type      varchar(64)          NOT NULL,
        provider_ref    varchar(64)          NOT NULL,
        payload_hash    char(64)             NOT NULL,
        payload         jsonb                NOT NULL,
        status          webhook_event_status NOT NULL DEFAULT 'PROCESSING',
        outcome         varchar(40),
        attempts        integer              NOT NULL DEFAULT 0,
        last_error      text,
        processed_at    timestamptz,
        created_at      timestamptz          NOT NULL DEFAULT now(),
        updated_at      timestamptz          NOT NULL DEFAULT now(),
        -- The heart of webhook idempotency: an event id can only ever be stored once.
        CONSTRAINT webhook_events_event_id_unique UNIQUE (event_id)
      );
    `);
    await sql(`CREATE INDEX webhook_events_provider_ref_idx ON webhook_events (provider_ref);`);
  },

  async down({ queryInterface }) {
    const sql = (q) => queryInterface.sequelize.query(q);
    await sql(`DROP TABLE IF EXISTS webhook_events, payments, bookings, centre_tests, diagnostic_tests, diagnostic_centres, users CASCADE;`);
    await sql(`DROP TYPE IF EXISTS webhook_event_status, payment_status, booking_status, user_role;`);
  },
};
