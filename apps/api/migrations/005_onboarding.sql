-- Self-serve onboarding progress (e.g. when QR stickers were printed).
ALTER TABLE tenants ADD COLUMN onboarding jsonb NOT NULL DEFAULT '{}';
