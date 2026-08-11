import { loadConfig } from "@/server/config";
import { initializeDatabase } from "./migrations";

const { sqlite } = initializeDatabase(loadConfig().databasePath);
sqlite.close();
console.log("Database schema is up to date.");
