-- Google Workspace is a verified external identity source, not a client-supplied
-- email header. Only an API that verified a signed Google ID token may call
-- this narrow session issuance function; never expose its EXECUTE grant to app.
CREATE TABLE rcat_private.google_identities (
  user_id uuid PRIMARY KEY REFERENCES rcat.users(id) ON DELETE CASCADE,
  google_sub text NOT NULL UNIQUE CHECK(length(google_sub) BETWEEN 1 AND 255
    AND google_sub ~ '^[A-Za-z0-9_-]+),
  email text NOT NULL UNIQUE CHECK(
    email=lower(trim(email)) AND email ~ '^[^[:space:]@]+@rcat[.]ac[.]th$'
  ),
  linked_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON rcat_private.google_identities FROM PUBLIC;
REVOKE ALL ON rcat_private.google_identities FROM rcat_auth,rcat_app;

CREATE FUNCTION rcat_private.issue_google_workspace_session(
  p_email text,p_google_sub text,p_session_digest bytea,p_csrf_digest bytea
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_user uuid;v_sub text;v_owner uuid;
BEGIN
  IF p_email IS NULL OR p_email<>lower(trim(p_email))
    OR p_email !~ '^[^[:space:]@]+@rcat[.]ac[.]th$'
    OR length(p_email)>254 OR p_google_sub IS NULL
    OR p_google_sub !~ '^[A-Za-z0-9_-]+
    OR length(p_google_sub) NOT BETWEEN 1 AND 255
    OR p_session_digest IS NULL OR octet_length(p_session_digest)<>32
    OR p_csrf_digest IS NULL OR octet_length(p_csrf_digest)<>32
  THEN RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='22023';
  END IF;

  -- No self-service provisioning. Only a pre-approved existing active
  -- account can establish a staff session from Google Workspace.
  SELECT u.id INTO v_user FROM rcat.users u
   WHERE u.email=p_email AND u.is_active FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='42501';
  END IF;

  SELECT g.google_sub INTO v_sub FROM rcat_private.google_identities g
   WHERE g.user_id=v_user FOR UPDATE;
  IF v_sub IS NOT NULL AND v_sub<>p_google_sub THEN
    RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='42501';
  END IF;
  SELECT g.user_id INTO v_owner FROM rcat_private.google_identities g
   WHERE g.google_sub=p_google_sub FOR UPDATE;
  IF v_owner IS NOT NULL AND v_owner<>v_user THEN
    RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='42501';
  END IF;

  IF v_sub IS NULL THEN
    INSERT INTO rcat_private.google_identities(user_id,google_sub,email)
    VALUES(v_user,p_google_sub,p_email);
  END IF;
  INSERT INTO rcat_private.auth_sessions(
    user_id,token_digest,csrf_digest,expires_at
  ) VALUES(v_user,p_session_digest,p_csrf_digest,now()+interval '12 hours');
  RETURN v_user;
END $$;
REVOKE ALL ON FUNCTION rcat_private.issue_google_workspace_session(
  text,text,bytea,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.issue_google_workspace_session(
  text,text,bytea,bytea) TO rcat_auth;
),
  email text NOT NULL UNIQUE CHECK(
    email=lower(trim(email)) AND email ~ '^[^[:space:]@]+@rcat[.]ac[.]th$'
  ),
  linked_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON rcat_private.google_identities FROM PUBLIC;
REVOKE ALL ON rcat_private.google_identities FROM rcat_auth,rcat_app;

CREATE FUNCTION rcat_private.issue_google_workspace_session(
  p_email text,p_google_sub text,p_session_digest bytea,p_csrf_digest bytea
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_user uuid;v_sub text;v_owner uuid;
BEGIN
  IF p_email IS NULL OR p_email<>lower(trim(p_email))
    OR p_email !~ '^[^[:space:]@]+@rcat[.]ac[.]th$'
    OR length(p_email)>254 OR p_google_sub IS NULL
    OR p_google_sub !~ '^[0-9]+$'
    OR length(p_google_sub) NOT BETWEEN 1 AND 255
    OR p_session_digest IS NULL OR octet_length(p_session_digest)<>32
    OR p_csrf_digest IS NULL OR octet_length(p_csrf_digest)<>32
  THEN RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='22023';
  END IF;

  -- No self-service provisioning. Only a pre-approved existing active
  -- account can establish a staff session from Google Workspace.
  SELECT u.id INTO v_user FROM rcat.users u
   WHERE u.email=p_email AND u.is_active FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='42501';
  END IF;

  SELECT g.google_sub INTO v_sub FROM rcat_private.google_identities g
   WHERE g.user_id=v_user FOR UPDATE;
  IF v_sub IS NOT NULL AND v_sub<>p_google_sub THEN
    RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='42501';
  END IF;
  SELECT g.user_id INTO v_owner FROM rcat_private.google_identities g
   WHERE g.google_sub=p_google_sub FOR UPDATE;
  IF v_owner IS NOT NULL AND v_owner<>v_user THEN
    RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='42501';
  END IF;

  IF v_sub IS NULL THEN
    INSERT INTO rcat_private.google_identities(user_id,google_sub,email)
    VALUES(v_user,p_google_sub,p_email);
  END IF;
  INSERT INTO rcat_private.auth_sessions(
    user_id,token_digest,csrf_digest,expires_at
  ) VALUES(v_user,p_session_digest,p_csrf_digest,now()+interval '12 hours');
  RETURN v_user;
END $$;
REVOKE ALL ON FUNCTION rcat_private.issue_google_workspace_session(
  text,text,bytea,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.issue_google_workspace_session(
  text,text,bytea,bytea) TO rcat_auth;

    OR length(p_google_sub) NOT BETWEEN 1 AND 255
    OR p_session_digest IS NULL OR octet_length(p_session_digest)<>32
    OR p_csrf_digest IS NULL OR octet_length(p_csrf_digest)<>32
  THEN RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='22023';
  END IF;

  -- No self-service provisioning. Only a pre-approved existing active
  -- account can establish a staff session from Google Workspace.
  SELECT u.id INTO v_user FROM rcat.users u
   WHERE u.email=p_email AND u.is_active FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='42501';
  END IF;

  SELECT g.google_sub INTO v_sub FROM rcat_private.google_identities g
   WHERE g.user_id=v_user FOR UPDATE;
  IF v_sub IS NOT NULL AND v_sub<>p_google_sub THEN
    RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='42501';
  END IF;
  SELECT g.user_id INTO v_owner FROM rcat_private.google_identities g
   WHERE g.google_sub=p_google_sub FOR UPDATE;
  IF v_owner IS NOT NULL AND v_owner<>v_user THEN
    RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='42501';
  END IF;

  IF v_sub IS NULL THEN
    INSERT INTO rcat_private.google_identities(user_id,google_sub,email)
    VALUES(v_user,p_google_sub,p_email);
  END IF;
  INSERT INTO rcat_private.auth_sessions(
    user_id,token_digest,csrf_digest,expires_at
  ) VALUES(v_user,p_session_digest,p_csrf_digest,now()+interval '12 hours');
  RETURN v_user;
END $$;
REVOKE ALL ON FUNCTION rcat_private.issue_google_workspace_session(
  text,text,bytea,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.issue_google_workspace_session(
  text,text,bytea,bytea) TO rcat_auth;
),
  email text NOT NULL UNIQUE CHECK(
    email=lower(trim(email)) AND email ~ '^[^[:space:]@]+@rcat[.]ac[.]th$'
  ),
  linked_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON rcat_private.google_identities FROM PUBLIC;
REVOKE ALL ON rcat_private.google_identities FROM rcat_auth,rcat_app;

CREATE FUNCTION rcat_private.issue_google_workspace_session(
  p_email text,p_google_sub text,p_session_digest bytea,p_csrf_digest bytea
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_user uuid;v_sub text;v_owner uuid;
BEGIN
  IF p_email IS NULL OR p_email<>lower(trim(p_email))
    OR p_email !~ '^[^[:space:]@]+@rcat[.]ac[.]th$'
    OR length(p_email)>254 OR p_google_sub IS NULL
    OR p_google_sub !~ '^[A-Za-z0-9_-]+
    OR length(p_google_sub) NOT BETWEEN 1 AND 255
    OR p_session_digest IS NULL OR octet_length(p_session_digest)<>32
    OR p_csrf_digest IS NULL OR octet_length(p_csrf_digest)<>32
  THEN RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='22023';
  END IF;

  -- No self-service provisioning. Only a pre-approved existing active
  -- account can establish a staff session from Google Workspace.
  SELECT u.id INTO v_user FROM rcat.users u
   WHERE u.email=p_email AND u.is_active FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='42501';
  END IF;

  SELECT g.google_sub INTO v_sub FROM rcat_private.google_identities g
   WHERE g.user_id=v_user FOR UPDATE;
  IF v_sub IS NOT NULL AND v_sub<>p_google_sub THEN
    RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='42501';
  END IF;
  SELECT g.user_id INTO v_owner FROM rcat_private.google_identities g
   WHERE g.google_sub=p_google_sub FOR UPDATE;
  IF v_owner IS NOT NULL AND v_owner<>v_user THEN
    RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='42501';
  END IF;

  IF v_sub IS NULL THEN
    INSERT INTO rcat_private.google_identities(user_id,google_sub,email)
    VALUES(v_user,p_google_sub,p_email);
  END IF;
  INSERT INTO rcat_private.auth_sessions(
    user_id,token_digest,csrf_digest,expires_at
  ) VALUES(v_user,p_session_digest,p_csrf_digest,now()+interval '12 hours');
  RETURN v_user;
END $$;
REVOKE ALL ON FUNCTION rcat_private.issue_google_workspace_session(
  text,text,bytea,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.issue_google_workspace_session(
  text,text,bytea,bytea) TO rcat_auth;

    OR length(p_google_sub) NOT BETWEEN 1 AND 255
    OR p_session_digest IS NULL OR octet_length(p_session_digest)<>32
    OR p_csrf_digest IS NULL OR octet_length(p_csrf_digest)<>32
  THEN RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='22023';
  END IF;

  -- No self-service provisioning. Only a pre-approved existing active
  -- account can establish a staff session from Google Workspace.
  SELECT u.id INTO v_user FROM rcat.users u
   WHERE u.email=p_email AND u.is_active FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='42501';
  END IF;

  SELECT g.google_sub INTO v_sub FROM rcat_private.google_identities g
   WHERE g.user_id=v_user FOR UPDATE;
  IF v_sub IS NOT NULL AND v_sub<>p_google_sub THEN
    RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='42501';
  END IF;
  SELECT g.user_id INTO v_owner FROM rcat_private.google_identities g
   WHERE g.google_sub=p_google_sub FOR UPDATE;
  IF v_owner IS NOT NULL AND v_owner<>v_user THEN
    RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='42501';
  END IF;

  IF v_sub IS NULL THEN
    INSERT INTO rcat_private.google_identities(user_id,google_sub,email)
    VALUES(v_user,p_google_sub,p_email);
  END IF;
  INSERT INTO rcat_private.auth_sessions(
    user_id,token_digest,csrf_digest,expires_at
  ) VALUES(v_user,p_session_digest,p_csrf_digest,now()+interval '12 hours');
  RETURN v_user;
END $$;
REVOKE ALL ON FUNCTION rcat_private.issue_google_workspace_session(
  text,text,bytea,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.issue_google_workspace_session(
  text,text,bytea,bytea) TO rcat_auth;
