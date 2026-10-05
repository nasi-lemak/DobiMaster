-- Owner push alerts belong to a signed-in device: once that session is signed out or revoked, its
-- subscription stops receiving business alerts. NULL = not an owner subscription.
ALTER TABLE push_subscriptions ADD COLUMN owner_session_id uuid REFERENCES owner_sessions(id) ON DELETE SET NULL;
