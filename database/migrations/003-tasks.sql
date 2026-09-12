CREATE TABLE tasks (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users, name text NOT NULL,
  snapshot jsonb NOT NULL, status text NOT NULL DEFAULT 'draft', parent_id uuid REFERENCES tasks,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_owner ON tasks(owner_id,created_at DESC);
CREATE TABLE results (
  id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES tasks, number integer NOT NULL,
  output jsonb NOT NULL, confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(task_id,number)
);
CREATE TABLE quotas (
  user_id uuid NOT NULL REFERENCES users, kind text NOT NULL CHECK(kind IN ('text','image')),
  allowance integer NOT NULL DEFAULT 0 CHECK(allowance>=0), used integer NOT NULL DEFAULT 0 CHECK(used>=0),
  reserved integer NOT NULL DEFAULT 0 CHECK(reserved>=0), PRIMARY KEY(user_id,kind)
);
CREATE TABLE jobs (
  id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES tasks, owner_id uuid NOT NULL REFERENCES users,
  kind text NOT NULL CHECK(kind IN ('text','image')), status text NOT NULL DEFAULT 'queued', payload jsonb NOT NULL DEFAULT '{}',
  submit_key text NOT NULL, provider jsonb NOT NULL, attempts integer NOT NULL DEFAULT 0,
  lease_token uuid, lease_until timestamptz, sent_at timestamptz, error text,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,submit_key)
);
CREATE INDEX jobs_queue ON jobs(status,created_at);
CREATE TABLE attempts (
  id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES jobs, number integer NOT NULL, status text NOT NULL,
  raw_output text, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  UNIQUE(job_id,number)
);
CREATE TABLE usage_ledger (
  id bigserial PRIMARY KEY, user_id uuid NOT NULL REFERENCES users, job_id uuid NOT NULL REFERENCES jobs,
  kind text NOT NULL, action text NOT NULL, count integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE assets (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users, name text NOT NULL, kind text NOT NULL,
  media_id uuid NOT NULL REFERENCES media, task_id uuid REFERENCES tasks, result_id uuid REFERENCES results,
  parent_id uuid REFERENCES assets, confirmed boolean NOT NULL DEFAULT false, batch integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE asset_bindings (
  id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES tasks, result_id uuid NOT NULL REFERENCES results,
  asset_id uuid NOT NULL REFERENCES assets, kind text NOT NULL, batch integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE exports (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users, task_id uuid NOT NULL REFERENCES tasks,
  result_id uuid NOT NULL REFERENCES results, media_id uuid NOT NULL REFERENCES media,
  complete boolean NOT NULL, manifest jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
