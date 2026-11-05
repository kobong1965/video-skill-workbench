CREATE TABLE product_catalog_selections (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users,
  selection_key text NOT NULL CHECK(length(selection_key)=64),
  product_uid uuid NOT NULL,
  source_hash text NOT NULL CHECK(length(source_hash)=64),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,selection_key)
);
CREATE INDEX product_catalog_selections_owner ON product_catalog_selections(owner_id,created_at DESC);
