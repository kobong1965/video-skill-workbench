CREATE TABLE users (
  id uuid PRIMARY KEY, username text UNIQUE NOT NULL, display_name text NOT NULL,
  password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('admin','member')),
  active boolean NOT NULL DEFAULT true, preferences jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE invitations (
  id uuid PRIMARY KEY, token_hash text UNIQUE NOT NULL, creator_id uuid NOT NULL REFERENCES users,
  expires_at timestamptz NOT NULL, used_by uuid REFERENCES users, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users,
  csrf text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE media (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users, name text NOT NULL,
  mime text NOT NULL, size bigint NOT NULL, digest text NOT NULL, disk_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit (
  id bigserial PRIMARY KEY, user_id uuid REFERENCES users, action text NOT NULL,
  resource_id text, created_at timestamptz NOT NULL DEFAULT now()
);
