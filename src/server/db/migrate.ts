import { loadConfig } from "@/server/config";
import { closeDatabase } from "./connection";
import { initializeDatabase } from "./migrations";

async function main() {
  const config = loadConfig();
  const connection = await initializeDatabase({
    url: config.databaseUrl,
    sslCaPath: config.databaseSslCaPath,
    poolSize: config.DATABASE_POOL_SIZE,
  });
  await closeDatabase(connection);
  console.log("MySQL database schema is up to date.");
}

void main().catch((error: unknown) => {
  console.error("MySQL database migration failed.", error);
  process.exitCode = 1;
});
