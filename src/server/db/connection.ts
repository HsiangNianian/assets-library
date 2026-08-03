import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export function openDatabase(databasePath: string) {
  const resolvedPath = path.resolve(databasePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const sqlite = new Database(resolvedPath);
  sqlite.pragma("busy_timeout = 5000");
  // Setting journal_mode acquires a write lock. API route modules are imported
  // during `next build`, potentially while the worker is writing, so only
  // change it when this database has not already been configured for WAL.
  const journalMode = String(sqlite.pragma("journal_mode", { simple: true })).toLowerCase();
  if (journalMode !== "wal") sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export type DatabaseConnection = ReturnType<typeof openDatabase>;
