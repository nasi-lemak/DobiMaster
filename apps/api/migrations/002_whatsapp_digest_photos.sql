-- WhatsApp "notify me" channel, weekly owner digest, photo attachments.

-- A WhatsApp number linked to a customer (guest) or an owner-side user by a customer-initiated message.
-- Free-form replies are only allowed within 24 h of the contact's last inbound message (WhatsApp rule).
CREATE TABLE wa_contacts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_id            text NOT NULL UNIQUE,              -- E.164 without '+', as WhatsApp sends it
  customer_id      uuid REFERENCES customers(id) ON DELETE CASCADE,
  user_id          uuid REFERENCES users(id) ON DELETE CASCADE,
  locale           text NOT NULL DEFAULT 'en',
  last_inbound_at  timestamptz NOT NULL,
  opted_out        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_contacts_customer_idx ON wa_contacts(customer_id);
CREATE INDEX wa_contacts_user_idx ON wa_contacts(user_id);

-- One-time codes the customer sends us ("DOBI-7K3QXM") to link their number.
CREATE TABLE wa_link_codes (
  code         text PRIMARY KEY,
  customer_id  uuid REFERENCES customers(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  cycle_id     uuid REFERENCES cycles(id) ON DELETE SET NULL,
  locale       text NOT NULL DEFAULT 'en',
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (customer_id IS NOT NULL OR user_id IS NOT NULL)
);

-- Outbound/inbound log: debugging, cost tracking (templates are billed), 30-day retention.
CREATE TABLE wa_messages (
  id                   bigserial PRIMARY KEY,
  direction            text NOT NULL CHECK (direction IN ('in','out')),
  wa_id                text NOT NULL,
  kind                 text NOT NULL,         -- text | template | skipped_window | opted_out | error
  template             text,
  body                 text,
  provider_message_id  text,
  error                text,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_messages_created_idx ON wa_messages(created_at);

-- Photos for problem reports and checklist items.
CREATE TABLE attachments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid REFERENCES tenants(id) ON DELETE CASCADE,  -- set when linked (or at upload for staff)
  uploader_customer_id  uuid REFERENCES customers(id) ON DELETE SET NULL,
  uploader_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  content_type          text NOT NULL,
  size_bytes            integer NOT NULL,
  sha256                text NOT NULL,
  storage_key           text NOT NULL UNIQUE,
  ticket_id             uuid REFERENCES tickets(id) ON DELETE CASCADE,
  checklist_run_id      uuid REFERENCES checklist_runs(id) ON DELETE CASCADE,
  checklist_item_id     text,
  linked_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_ticket_idx ON attachments(ticket_id);
CREATE INDEX attachments_run_idx ON attachments(checklist_run_id);
CREATE INDEX attachments_unlinked_idx ON attachments(created_at) WHERE linked_at IS NULL;

-- One digest per tenant per week, whichever replica gets there first.
CREATE TABLE digest_log (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  week_start  date NOT NULL,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  recipients  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, week_start)
);

ALTER TABLE users ADD COLUMN digest_opt_out boolean NOT NULL DEFAULT false;
