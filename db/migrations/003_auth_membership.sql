-- Allow the authentication service to resolve memberships for a previously verified user.
-- app.auth_user_id is set transaction-locally ONLY by trusted backend after session
-- verification. This database policy is defense-in-depth, not a login mechanism.
GRANT SELECT (tenant_id, user_id, role) ON rcat.tenant_memberships TO rcat_auth;

CREATE POLICY auth_verified_user_memberships
  ON rcat.tenant_memberships FOR SELECT TO rcat_auth
  USING (
    user_id = NULLIF(current_setting('app.auth_user_id', true), '')::uuid
  );
