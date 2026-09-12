CREATE TABLE skills (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users, name text NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]', visibility text NOT NULL CHECK(visibility IN ('public','private')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE skill_versions (
  id uuid PRIMARY KEY, skill_id uuid NOT NULL REFERENCES skills, number integer NOT NULL,
  kind text NOT NULL, duration numeric NOT NULL CHECK(duration>0), text text NOT NULL,
  source text NOT NULL DEFAULT '', missing jsonb NOT NULL DEFAULT '[]', source_media_id uuid REFERENCES media,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(skill_id,number)
);
CREATE TABLE skill_files (
  version_id uuid NOT NULL REFERENCES skill_versions, path text NOT NULL, mime text NOT NULL,
  media_id uuid REFERENCES media, text text, PRIMARY KEY(version_id,path)
);
CREATE TABLE drafts (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users, name text NOT NULL,
  input jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
