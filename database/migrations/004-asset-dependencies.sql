ALTER TABLE assets ADD COLUMN dependencies jsonb NOT NULL DEFAULT '[]';
