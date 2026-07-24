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
    migrateDatabase(connection, migrationsFolder);
    return connection;
  } catch (error) {
    connection.sqlite.close();
    throw error;
  }
}
