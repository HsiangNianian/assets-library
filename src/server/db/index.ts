import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { loadConfig } from "@/server/config";
import * as schema from "./schema";

const globalDatabase = globalThis as typeof globalThis & {
  __assetLibrarySqlite?: Database.Database;
};

const schemaSql = `
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL, original_filename TEXT NOT NULL, original_path TEXT NOT NULL,
  mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, direct_publish INTEGER NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'queued', review_status TEXT NOT NULL DEFAULT 'pending_review',
  failure_code TEXT, failure_message TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS assets_review_created_idx ON assets(review_status, created_at);
CREATE TABLE IF NOT EXISTS upload_requests (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL UNIQUE REFERENCES assets(id),
  client_filename TEXT NOT NULL, declared_mime TEXT NOT NULL, size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS processing_jobs (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id), type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', attempt INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL, claimed_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_queue_idx ON processing_jobs(status, available_at);
CREATE TABLE IF NOT EXISTS analysis_results (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id), schema_version INTEGER NOT NULL DEFAULT 1,
  result_json TEXT NOT NULL, model_protocol TEXT NOT NULL, model_name TEXT NOT NULL,
  completed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY, category TEXT NOT NULL, value TEXT NOT NULL, normalized_value TEXT NOT NULL,
  created_at INTEGER NOT NULL, UNIQUE(category, normalized_value)
);
CREATE TABLE IF NOT EXISTS asset_tags (
  asset_id TEXT NOT NULL REFERENCES assets(id), tag_id TEXT NOT NULL REFERENCES tags(id),
  source TEXT NOT NULL, confidence REAL, PRIMARY KEY(asset_id, tag_id)
);
CREATE TABLE IF NOT EXISTS asset_tag_rejections (
  asset_id TEXT NOT NULL REFERENCES assets(id), category TEXT NOT NULL,
  normalized_value TEXT NOT NULL, PRIMARY KEY(asset_id, category, normalized_value)
);
`;

export function openDatabase(databasePath?: string) {
  const config = loadConfig();
  const resolvedPath = databasePath ?? config.databasePath;
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const sqlite =
    databasePath || !globalDatabase.__assetLibrarySqlite
      ? new Database(resolvedPath)
      : globalDatabase.__assetLibrarySqlite;
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(schemaSql);
  if (!databasePath) globalDatabase.__assetLibrarySqlite = sqlite;
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export const { sqlite, db } = openDatabase();
