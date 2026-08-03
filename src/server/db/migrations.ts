import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  openDatabase,
  type DatabaseConnection,
} from "@/server/db/connection";

export const defaultMigrationsFolder = path.resolve(
  process.cwd(),
  "drizzle",
);

export function migrateDatabase(
  connection: DatabaseConnection,
  migrationsFolder = defaultMigrationsFolder,
) {
  migrate(connection.db, { migrationsFolder });
}

export function initializeDatabase(
  databasePath: string,
  migrationsFolder = defaultMigrationsFolder,
) {
  const connection = openDatabase(databasePath);
  try {
    // This is the only place that changes the database-wide journal mode.
    // Docker runs it under flock before starting either the web server or the
    // worker, so concurrent service startup cannot race this PRAGMA.
    connection.sqlite.pragma("journal_mode = WAL");
    migrateDatabase(connection, migrationsFolder);
    return connection;
  } catch (error) {
    connection.sqlite.close();
    throw error;
  }
}
