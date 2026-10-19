CREATE TABLE canvas_imports (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  task_id uuid NOT NULL REFERENCES tasks(id),
  result_id uuid NOT NULL REFERENCES results(id),
  submit_key uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','unknown')),
  project_id text,
  new_project_name text,
  plan jsonb NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,submit_key)
);
CREATE INDEX canvas_imports_task ON canvas_imports(task_id,created_at DESC);
