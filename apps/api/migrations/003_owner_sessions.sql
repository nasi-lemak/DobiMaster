-- Server-side owner sessions: logging out (or "sign out other devices") revokes a session for real,
-- instead of only clearing the cookie on one browser.
CREATE TABLE owner_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_agent    text,
  ip            text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX owner_sessions_user_idx ON owner_sessions(user_id) WHERE revoked_at IS NULL;
