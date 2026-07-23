import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "@/server/db";

describe("database initialization", () => {
  it("creates every MVP table and enables WAL", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "asset-db-"));
    const databasePath = path.join(directory, "assets.db");
    const { sqlite, db } = openDatabase(databasePath);
    const tableNames = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);
    for (const tableName of [
      "assets",
      "upload_requests",
      "processing_jobs",
      "analysis_results",
      "tags",
      "asset_tags",
      "asset_tag_rejections",
    ]) {
      expect(tableNames).toContain(tableName);
    }
    expect(sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    void db;
    sqlite.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
