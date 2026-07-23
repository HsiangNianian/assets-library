CREATE TABLE assets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL, original_filename TEXT NOT NULL, original_path TEXT NOT NULL,
  mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, direct_publish INTEGER NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'queued', review_status TEXT NOT NULL DEFAULT 'pending_review',
  failure_code TEXT, failure_message TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE upload_requests (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL UNIQUE REFERENCES assets(id),
  client_filename TEXT NOT NULL, declared_mime TEXT NOT NULL, size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE processing_jobs (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id), type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', attempt INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL, claimed_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE analysis_results (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id), schema_version INTEGER NOT NULL DEFAULT 1,
  result_json TEXT NOT NULL, model_protocol TEXT NOT NULL, model_name TEXT NOT NULL,
  completed_at INTEGER NOT NULL
);
CREATE TABLE tags (
  id TEXT PRIMARY KEY, category TEXT NOT NULL, value TEXT NOT NULL,
  normalized_value TEXT NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE(category, normalized_value)
);
CREATE TABLE asset_tags (
  asset_id TEXT NOT NULL REFERENCES assets(id), tag_id TEXT NOT NULL REFERENCES tags(id),
  source TEXT NOT NULL, confidence REAL, PRIMARY KEY(asset_id, tag_id)
);
CREATE TABLE asset_tag_rejections (
  asset_id TEXT NOT NULL REFERENCES assets(id), category TEXT NOT NULL,
  normalized_value TEXT NOT NULL, PRIMARY KEY(asset_id, category, normalized_value)
);
