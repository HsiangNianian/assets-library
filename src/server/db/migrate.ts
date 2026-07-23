import { openDatabase } from "./index";

const { sqlite } = openDatabase(process.env.DATABASE_PATH);
sqlite.close();
console.log("Database schema is up to date.");
