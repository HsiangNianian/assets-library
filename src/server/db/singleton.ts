import { loadConfig } from "@/server/config";
import {
  openDatabase,
  type DatabaseConnection,
} from "@/server/db/connection";

const globalDatabase = globalThis as typeof globalThis & {
  __assetLibraryDatabase?: DatabaseConnection;
};

/** Next.js 开发热更新时复用同一连接池，避免重复建立远程 MySQL 连接。 */
export function getDatabase() {
  if (!globalDatabase.__assetLibraryDatabase) {
    const config = loadConfig();
    globalDatabase.__assetLibraryDatabase = openDatabase({
      url: config.databaseUrl,
      sslCaPath: config.databaseSslCaPath,
      poolSize: config.DATABASE_POOL_SIZE,
    });
  }
  return globalDatabase.__assetLibraryDatabase;
}
