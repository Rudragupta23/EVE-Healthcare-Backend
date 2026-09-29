'use strict';

// Converts database rows into the public API shape (snake_case, no internal fields).
// Keeping this in one place means the API contract does not change by accident when a model does.

const iso = (d) => (d ? new Date(d).toISOString() : null);

const user = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, created_at: iso(u.createdAt) });

const test = (t) => ({ id: t.id, name: t.name, description: t.description ?? null });

const centre = (c) => {
  const out = { id: c.id, name: c.name, address: c.address, city: c.city };
  if (c.tests) {
    out.tests = c.tests.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description ?? null,
      price_paise: t.CentreTest.pricePaise,
      is_available: t.CentreTest.isAvailable,
    }));
  }
  return out;
};

const payment = (p) => ({
  id: p.id,
  booking_id: p.bookingId,
  amount_paise: p.amountPaise,
  currency: p.currency,
  status: p.status,
  provider_ref: p.providerRef,
  failure_reason: p.failureReason ?? null,
  created_at: iso(p.createdAt),
  updated_at: iso(p.updatedAt),
});

const booking = (b) => ({
  id: b.id,
  user_id: b.userId,
  centre: b.centre ? { id: b.centre.id, name: b.centre.name, city: b.centre.city } : { id: b.centreId },
  test: b.test ? { id: b.test.id, name: b.test.name } : { id: b.testId },
  appointment_at: iso(b.appointmentAt),
  amount_paise: b.amountPaise,
  currency: b.currency,
  status: b.status,
  payment: b.payment ? payment(b.payment) : null,
  cancelled_at: iso(b.cancelledAt),
  created_at: iso(b.createdAt),
  updated_at: iso(b.updatedAt),
});

module.exports = { user, test, centre, booking, payment };
