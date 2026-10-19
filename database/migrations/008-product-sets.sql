CREATE TABLE product_sets (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users,
  style_number text NOT NULL CHECK(length(style_number) BETWEEN 1 AND 80 AND style_number=btrim(style_number)),
  name text NOT NULL DEFAULT '' CHECK(length(name)<=100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_sets_owner_style_unique ON product_sets(owner_id,lower(style_number));
CREATE INDEX product_sets_owner_updated ON product_sets(owner_id,updated_at DESC,id);
CREATE TABLE product_set_media (
  product_set_id uuid NOT NULL REFERENCES product_sets ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES media,
  role text NOT NULL CHECK(role IN ('product','detail','comparison')),
  position integer NOT NULL CHECK(position BETWEEN 0 AND 11),
  PRIMARY KEY(product_set_id,media_id),
  UNIQUE(product_set_id,position)
);
