import { loadConfig } from "@/server/config";
import {
  openDatabase,
  type DatabaseConnection,
} from "@/server/db/connection";

const globalDatabase = globalThis as typeof globalThis & {
  __assetLibraryDatabase?: DatabaseConnection;
};

export function getDatabase() {
  if (!globalDatabase.__assetLibraryDatabase) {
    globalDatabase.__assetLibraryDatabase = openDatabase(
      loadConfig().databasePath,
    );
  }
  return globalDatabase.__assetLibraryDatabase;
}
