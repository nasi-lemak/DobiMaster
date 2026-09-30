-- DobiMaster initial schema. Money is integer sen; all timestamps are timestamptz.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  plan        text NOT NULL DEFAULT 'starter',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE,
  name           text NOT NULL,
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('owner','manager','staff')),
  shop_ids    uuid[],               -- NULL = all shops of the tenant
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE shops (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug           text NOT NULL UNIQUE,
  name           text NOT NULL,
  address        text NOT NULL DEFAULT '',
  lat            double precision,
  lng            double precision,
  timezone       text NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  phone          text,
  whatsapp       text,
  opening_hours  jsonb NOT NULL,
  facilities     jsonb NOT NULL DEFAULT '{}',
  policy         jsonb NOT NULL DEFAULT '{}',   -- i18n text shown to customers
  settings       jsonb NOT NULL DEFAULT '{}',
  is_published   boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shops_tenant_idx ON shops(tenant_id);

CREATE TABLE devices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shop_id        uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('generic_power','shelly','esp32_ct','simulator')),
  label          text NOT NULL DEFAULT '',
  token_hash     text NOT NULL UNIQUE,
  config         jsonb NOT NULL DEFAULT '{}',   -- detector thresholds
  detector       jsonb NOT NULL DEFAULT '{}',   -- persisted detector state
  heartbeat_sec  integer NOT NULL DEFAULT 60,
  last_seen_at   timestamptz,
  last_power_w   double precision,
  online         boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE machines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shop_id               uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  code                  text NOT NULL,                    -- human label on the machine, e.g. W3
  qr_token              text NOT NULL UNIQUE,             -- random, printed in the QR URL
  type                  text NOT NULL CHECK (type IN ('washer','dryer')),
  capacity_kg           numeric(5,1) NOT NULL,
  brand                 text,
  model                 text,
  programs              jsonb NOT NULL DEFAULT '[]',
  instructions          jsonb NOT NULL DEFAULT '{}',      -- i18n
  recommended_load      jsonb NOT NULL DEFAULT '{}',      -- i18n
  detergent_auto        boolean NOT NULL DEFAULT false,
  softener_auto         boolean NOT NULL DEFAULT false,
  observation           text NOT NULL DEFAULT 'none' CHECK (observation IN ('none','power_monitor','vendor')),
  control               text NOT NULL DEFAULT 'none' CHECK (control IN ('none','simulated','pulse','vendor')),
  device_id             uuid UNIQUE REFERENCES devices(id) ON DELETE SET NULL,
  purchase_cost_sen     integer,
  installed_at          date,
  sort_order            integer NOT NULL DEFAULT 0,
  -- administrative state set by staff
  admin_state           text NOT NULL DEFAULT 'active' CHECK (admin_state IN ('active','maintenance','disabled')),
  admin_reason          text,
  staff_fault           boolean NOT NULL DEFAULT false,   -- staff-confirmed fault
  -- derived state (written only by the state reducer)
  state                 text NOT NULL DEFAULT 'available',
  state_source          text NOT NULL DEFAULT 'none',
  state_since           timestamptz NOT NULL DEFAULT now(),
  current_cycle_id      uuid,
  deleted_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, code)
);
CREATE INDEX machines_shop_idx ON machines(shop_id) WHERE deleted_at IS NULL;

CREATE TABLE machine_state_log (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  shop_id     uuid NOT NULL,
  machine_id  uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  state       text NOT NULL,
  source      text NOT NULL,
  reason      text,
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz
);
CREATE INDEX machine_state_log_machine_idx ON machine_state_log(machine_id, started_at DESC);
CREATE UNIQUE INDEX machine_state_log_open_idx ON machine_state_log(machine_id) WHERE ended_at IS NULL;

CREATE TABLE customers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL DEFAULT 'guest' CHECK (kind IN ('guest','registered')),
  locale      text NOT NULL DEFAULT 'en',
  phone       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid REFERENCES customers(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES users(id) ON DELETE CASCADE,
  endpoint        text NOT NULL UNIQUE,
  keys            jsonb NOT NULL,
  locale          text NOT NULL DEFAULT 'en',
  failed_count    integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (customer_id IS NOT NULL OR user_id IS NOT NULL)
);

CREATE TABLE payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  shop_id           uuid NOT NULL REFERENCES shops(id),
  machine_id        uuid NOT NULL REFERENCES machines(id),
  customer_id       uuid NOT NULL REFERENCES customers(id),
  cycle_id          uuid,
  program_id        text NOT NULL,
  amount_sen        integer NOT NULL CHECK (amount_sen > 0),
  currency          text NOT NULL DEFAULT 'MYR',
  provider          text NOT NULL,
  provider_ref      text,
  status            text NOT NULL DEFAULT 'created',
  idempotency_key   text NOT NULL,
  failure_reason    text,
  refunded_sen      integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  succeeded_at      timestamptz,
  UNIQUE (customer_id, idempotency_key)
);
CREATE INDEX payments_tenant_idx ON payments(tenant_id, created_at DESC);
CREATE INDEX payments_pending_idx ON payments(status, created_at) WHERE status IN ('created','pending','refund_pending');

CREATE TABLE payment_events (
  id                 bigserial PRIMARY KEY,
  provider           text NOT NULL,
  provider_event_id  text NOT NULL,
  payment_id         uuid REFERENCES payments(id),
  type               text NOT NULL,
  payload            jsonb NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE cycles (
  id                uuid PRIMARY KEY,                 -- client-generated for idempotent retries
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  shop_id           uuid NOT NULL REFERENCES shops(id),
  machine_id        uuid NOT NULL REFERENCES machines(id),
  source            text NOT NULL CHECK (source IN ('customer','staff','sensor','payment')),
  status            text NOT NULL CHECK (status IN ('running','finished','collected','cancelled','aborted')),
  program_id        text,
  program_name      text,
  duration_min      integer NOT NULL,
  price_sen         integer,
  started_at        timestamptz NOT NULL,
  expected_end_at   timestamptz NOT NULL,
  ended_at          timestamptz,
  collected_at      timestamptz,
  customer_id       uuid REFERENCES customers(id),
  payment_id        uuid REFERENCES payments(id),
  sensor_confirmed  boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cycles_machine_idx ON cycles(machine_id, started_at DESC);
CREATE INDEX cycles_shop_time_idx ON cycles(shop_id, started_at);
CREATE INDEX cycles_customer_idx ON cycles(customer_id, started_at DESC);
CREATE UNIQUE INDEX cycles_one_running_per_machine ON cycles(machine_id) WHERE status = 'running';

ALTER TABLE payments ADD CONSTRAINT payments_cycle_fk FOREIGN KEY (cycle_id) REFERENCES cycles(id);

CREATE TABLE machine_commands (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id   uuid NOT NULL REFERENCES machines(id),
  payment_id   uuid UNIQUE REFERENCES payments(id),
  kind         text NOT NULL DEFAULT 'start',
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','acked','confirmed','failed')),
  attempts     integer NOT NULL DEFAULT 0,
  payload      jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE ticket_ref_seq START 1001;
CREATE TABLE tickets (
  id                  uuid PRIMARY KEY,               -- client-generated for idempotent retries
  ref                 bigint NOT NULL UNIQUE DEFAULT nextval('ticket_ref_seq'),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  shop_id             uuid NOT NULL REFERENCES shops(id),
  machine_id          uuid REFERENCES machines(id),
  category            text NOT NULL,
  severity            text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','rejected')),
  source              text NOT NULL CHECK (source IN ('customer','staff','system')),
  title               text NOT NULL,
  details             text,
  customer_id         uuid REFERENCES customers(id),
  created_by          uuid REFERENCES users(id),
  contact_phone       text,
  amount_claimed_sen  integer,
  cycle_id            uuid REFERENCES cycles(id),
  payment_id          uuid REFERENCES payments(id),
  assigned_to         uuid REFERENCES users(id),
  counts_as_fault     boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz
);
CREATE INDEX tickets_tenant_status_idx ON tickets(tenant_id, status, created_at DESC);
CREATE INDEX tickets_machine_idx ON tickets(machine_id, created_at DESC);

CREATE TABLE ticket_events (
  id          bigserial PRIMARY KEY,
  ticket_id   uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES users(id),
  kind        text NOT NULL,          -- created | status | assign | comment | refund
  body        text,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refunds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  shop_id       uuid NOT NULL REFERENCES shops(id),
  ticket_id     uuid REFERENCES tickets(id),
  payment_id    uuid REFERENCES payments(id),
  amount_sen    integer NOT NULL CHECK (amount_sen > 0),
  method        text NOT NULL CHECK (method IN ('original','duitnow','cash','other')),
  status        text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','paid','failed')),
  payout_phone  text,
  reference     text,
  note          text,
  automatic     boolean NOT NULL DEFAULT false,
  decided_by    uuid REFERENCES users(id),
  decided_at    timestamptz,
  paid_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refunds_tenant_idx ON refunds(tenant_id, status, created_at DESC);
CREATE UNIQUE INDEX refunds_one_auto_per_payment ON refunds(payment_id) WHERE automatic;

CREATE TABLE collections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  shop_id       uuid NOT NULL REFERENCES shops(id),
  collected_at  timestamptz NOT NULL,
  collected_by  uuid REFERENCES users(id),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collections_shop_idx ON collections(shop_id, collected_at DESC);

CREATE TABLE collection_lines (
  id               bigserial PRIMARY KEY,
  collection_id    uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  machine_id       uuid NOT NULL REFERENCES machines(id),
  amount_sen       integer NOT NULL CHECK (amount_sen >= 0),
  counter_reading  integer,
  UNIQUE (collection_id, machine_id)
);

CREATE TABLE maintenance_plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  shop_id             uuid NOT NULL REFERENCES shops(id),
  machine_id          uuid REFERENCES machines(id),     -- specific machine, or
  machine_type        text CHECK (machine_type IN ('washer','dryer')),  -- all machines of a type in the shop
  title               text NOT NULL,
  interval_days       integer,
  interval_cycles     integer,
  interval_run_hours  integer,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (machine_id IS NOT NULL OR machine_type IS NOT NULL),
  CHECK (interval_days IS NOT NULL OR interval_cycles IS NOT NULL OR interval_run_hours IS NOT NULL)
);

CREATE TABLE maintenance_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  shop_id       uuid NOT NULL REFERENCES shops(id),
  machine_id    uuid NOT NULL REFERENCES machines(id),
  plan_id       uuid REFERENCES maintenance_plans(id) ON DELETE SET NULL,
  performed_at  timestamptz NOT NULL,
  performed_by  uuid REFERENCES users(id),
  notes         text,
  cost_sen      integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX maintenance_logs_machine_idx ON maintenance_logs(machine_id, performed_at DESC);

CREATE TABLE checklist_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  shop_id     uuid NOT NULL REFERENCES shops(id),
  name        text NOT NULL,
  items       jsonb NOT NULL,       -- [{id, label}]
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE checklist_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  shop_id       uuid NOT NULL REFERENCES shops(id),
  template_id   uuid NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  run_date      date NOT NULL,
  completed     jsonb NOT NULL DEFAULT '{}',   -- {itemId: {by, byName, at}}
  completed_at  timestamptz,
  UNIQUE (template_id, run_date)
);

CREATE TABLE announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  shop_id     uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  message     jsonb NOT NULL,        -- i18n
  level       text NOT NULL DEFAULT 'info' CHECK (level IN ('info','warning')),
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  shop_id      uuid REFERENCES shops(id),
  machine_id   uuid REFERENCES machines(id),
  kind         text NOT NULL,
  severity     text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  message      text NOT NULL,
  dedupe_key   text NOT NULL,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);
CREATE UNIQUE INDEX alerts_open_dedupe ON alerts(tenant_id, dedupe_key) WHERE status <> 'resolved';

CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid NOT NULL,
  actor_id     uuid,
  actor_name   text,
  action       text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    text,
  before       jsonb,
  after        jsonb,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_idx ON audit_log(tenant_id, created_at DESC);

CREATE TABLE jobs (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL,
  run_at      timestamptz NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','cancelled')),
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  dedupe_key  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_due_idx ON jobs(run_at) WHERE status = 'queued';
CREATE INDEX jobs_dedupe_lookup_idx ON jobs(dedupe_key);
CREATE UNIQUE INDEX jobs_dedupe_idx ON jobs(dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','running');

CREATE TABLE app_settings (
  key    text PRIMARY KEY,
  value  jsonb NOT NULL
);
