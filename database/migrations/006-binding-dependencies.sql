ALTER TABLE asset_bindings ADD COLUMN dependencies jsonb;
ALTER TABLE asset_bindings ADD COLUMN parent_id uuid REFERENCES assets;
