'use strict';

/**
 * Sequelize models. The schema itself is owned by the migrations in src/db/migrations
 * (we never call sequelize.sync()), so these definitions only describe the tables.
 */
const { DataTypes } = require('sequelize');
const sequelize = require('../db');
const { ROLES, BOOKING_STATUS, PAYMENT_STATUS, WEBHOOK_EVENT_STATUS } = require('../utils/constants');

const id = { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 };

const User = sequelize.define(
  'User',
  {
    id,
    name: { type: DataTypes.STRING(100), allowNull: false },
    email: { type: DataTypes.STRING(255), allowNull: false },
    passwordHash: { type: DataTypes.STRING(255), allowNull: false },
    role: { type: DataTypes.ENUM(...Object.values(ROLES)), allowNull: false, defaultValue: ROLES.USER },
  },
  {
    tableName: 'users',
    defaultScope: { attributes: { exclude: ['passwordHash'] } },
    scopes: { withPassword: { attributes: { include: ['passwordHash'] } } },
  }
);

const Centre = sequelize.define(
  'Centre',
  {
    id,
    name: { type: DataTypes.STRING(150), allowNull: false },
    address: { type: DataTypes.STRING(255), allowNull: false },
    city: { type: DataTypes.STRING(100), allowNull: false },
  },
  { tableName: 'diagnostic_centres' }
);

const Test = sequelize.define(
  'Test',
  {
    id,
    name: { type: DataTypes.STRING(150), allowNull: false },
    description: { type: DataTypes.TEXT },
  },
  { tableName: 'diagnostic_tests' }
);

const CentreTest = sequelize.define(
  'CentreTest',
  {
    id,
    centreId: { type: DataTypes.UUID, allowNull: false },
    testId: { type: DataTypes.UUID, allowNull: false },
    pricePaise: { type: DataTypes.INTEGER, allowNull: false },
    isAvailable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  { tableName: 'centre_tests' }
);

const Booking = sequelize.define(
  'Booking',
  {
    id,
    userId: { type: DataTypes.UUID, allowNull: false },
    centreId: { type: DataTypes.UUID, allowNull: false },
    testId: { type: DataTypes.UUID, allowNull: false },
    appointmentAt: { type: DataTypes.DATE, allowNull: false },
    amountPaise: { type: DataTypes.INTEGER, allowNull: false },
    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'INR' },
    status: {
      type: DataTypes.ENUM(...Object.values(BOOKING_STATUS)),
      allowNull: false,
      defaultValue: BOOKING_STATUS.PENDING,
    },
    cancelledAt: { type: DataTypes.DATE },
  },
  { tableName: 'bookings' }
);

const Payment = sequelize.define(
  'Payment',
  {
    id,
    bookingId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },
    amountPaise: { type: DataTypes.INTEGER, allowNull: false },
    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'INR' },
    status: {
      type: DataTypes.ENUM(...Object.values(PAYMENT_STATUS)),
      allowNull: false,
      defaultValue: PAYMENT_STATUS.PENDING,
    },
    providerRef: { type: DataTypes.STRING(64), allowNull: false },
    idempotencyKey: { type: DataTypes.STRING(128) },
    failureReason: { type: DataTypes.STRING(255) },
  },
  { tableName: 'payments' }
);

const WebhookEvent = sequelize.define(
  'WebhookEvent',
  {
    id,
    eventId: { type: DataTypes.STRING(128), allowNull: false },
    eventType: { type: DataTypes.STRING(64), allowNull: false },
    providerRef: { type: DataTypes.STRING(64), allowNull: false },
    payloadHash: { type: DataTypes.CHAR(64), allowNull: false },
    payload: { type: DataTypes.JSONB, allowNull: false },
    status: {
      type: DataTypes.ENUM(...Object.values(WEBHOOK_EVENT_STATUS)),
      allowNull: false,
      defaultValue: WEBHOOK_EVENT_STATUS.PROCESSING,
    },
    outcome: { type: DataTypes.STRING(40) },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lastError: { type: DataTypes.TEXT },
    processedAt: { type: DataTypes.DATE },
  },
  { tableName: 'webhook_events' }
);

// ---------- associations ----------
Centre.belongsToMany(Test, { through: CentreTest, foreignKey: 'centreId', otherKey: 'testId', as: 'tests' });
Test.belongsToMany(Centre, { through: CentreTest, foreignKey: 'testId', otherKey: 'centreId', as: 'centres' });
CentreTest.belongsTo(Centre, { foreignKey: 'centreId', as: 'centre' });
CentreTest.belongsTo(Test, { foreignKey: 'testId', as: 'test' });

Booking.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Booking.belongsTo(Centre, { foreignKey: 'centreId', as: 'centre' });
Booking.belongsTo(Test, { foreignKey: 'testId', as: 'test' });
Booking.hasOne(Payment, { foreignKey: 'bookingId', as: 'payment' });

Payment.belongsTo(Booking, { foreignKey: 'bookingId', as: 'booking' });

module.exports = { sequelize, User, Centre, Test, CentreTest, Booking, Payment, WebhookEvent };
