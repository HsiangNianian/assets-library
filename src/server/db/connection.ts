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
  // `journal_mode` is a database-wide setting and obtains a write lock. It is
  // configured once by initializeDatabase(), which is serialized by the
  // container entrypoint. Keeping ordinary connections read-only with respect
  // to this setting prevents route-module imports during `next build` from
  // contending with the worker.
  sqlite.pragma("foreign_keys = ON");
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export type DatabaseConnection = ReturnType<typeof openDatabase>;
