-- Password reset, "notify me when free", energy per cycle.

CREATE TABLE password_resets (
  token_hash  text PRIMARY KEY,           -- sha256 of the emailed token; the token itself is never stored
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN password_changed_at timestamptz;

-- A customer waiting for a machine class ("washer 10 kg") at a shop. Served first-come, first-served:
-- each machine that frees up notifies one watcher, so one free machine doesn't send five people rushing.
CREATE TABLE machine_watches (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  shop_id              uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  machine_type         text NOT NULL CHECK (machine_type IN ('washer','dryer')),
  capacity_kg          numeric(5,1) NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  notified_at          timestamptz,
  notified_machine_id  uuid REFERENCES machines(id) ON DELETE SET NULL,
  cancelled_at         timestamptz
);
CREATE INDEX machine_watches_waiting_idx ON machine_watches(shop_id, machine_type, capacity_kg, created_at)
  WHERE notified_at IS NULL AND cancelled_at IS NULL;
CREATE UNIQUE INDEX machine_watches_one_active ON machine_watches(customer_id, shop_id, machine_type, capacity_kg)
  WHERE notified_at IS NULL AND cancelled_at IS NULL;

-- Measured by the power sensor at the end of a cycle (null for unsensored cycles).
ALTER TABLE cycles ADD COLUMN energy_wh double precision;
ALTER TABLE cycles ADD COLUMN avg_power_w double precision;
