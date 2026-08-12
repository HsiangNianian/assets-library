import path from "node:path";
import { migrate } from "drizzle-orm/mysql2/migrator";
import {
  closeDatabase,
  inspectDatabaseConnection,
  openDatabase,
  type DatabaseConnection,
  type DatabaseOptions,
} from "@/server/db/connection";

export const defaultMigrationsFolder = path.resolve(process.cwd(), "drizzle");

/** MySQL 迁移必须显式 await，避免 Web/worker 在 DDL 尚未完成时启动。 */
export async function migrateDatabase(
  connection: DatabaseConnection,
  migrationsFolder = defaultMigrationsFolder,
) {
  await migrate(connection.db, { migrationsFolder });
}

export async function initializeDatabase(
  options: DatabaseOptions,
  migrationsFolder = defaultMigrationsFolder,
) {
  const connection = openDatabase(options);
  try {
    await inspectDatabaseConnection(connection.pool);
    await migrateDatabase(connection, migrationsFolder);
    return connection;
  } catch (error) {
    await closeDatabase(connection);
    throw error;
  }
}
