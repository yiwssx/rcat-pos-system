\set ON_ERROR_STOP on
-- Ephemeral Workspace account for Google OAuth HTTP integration only.
-- No real personal data or Google credentials are seeded.
INSERT INTO rcat.users(id,email,password_hash,is_active)
VALUES(
  '10000000-0000-4000-8000-000000000045',
  'staff@rcat.ac.th',
  'scrypt$32768$BwcHBwcHBwcHBwcHBwcHBw$GPh5l7ryvsz3moUXdclMZoCce85CsHXDH4d5S8oADf8',
  true
) ON CONFLICT(email) DO NOTHING;
INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role)
VALUES('00000000-0000-4000-8000-000000000001',
       '10000000-0000-4000-8000-000000000045','manager')
ON CONFLICT(tenant_id,user_id) DO NOTHING;
