import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "@/server/db/connection";
import { initializeDatabase } from "@/server/db/migrations";

describe("database initialization", () => {
  it("opens and configures a connection without implicitly creating tables", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "asset-db-open-"));
    const connection = openDatabase(path.join(directory, "assets.db"));
    const tableNames = connection.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all();
    expect(tableNames).toEqual([]);
    expect(connection.sqlite.pragma("journal_mode", { simple: true })).toBe(
      "wal",
    );
    connection.sqlite.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("creates every MVP table and enables WAL", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "asset-db-"));
    const databasePath = path.join(directory, "assets.db");
    const { sqlite, db } = initializeDatabase(databasePath);
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
      "__drizzle_migrations",
    ]) {
      expect(tableNames).toContain(tableName);
    }
    expect(sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS count FROM __drizzle_migrations",
        )
        .get(),
    ).toEqual({ count: 1 });
    void db;
    sqlite.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("adopts an existing untracked schema without losing data", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "asset-db-adopt-"));
    const databasePath = path.join(directory, "assets.db");
    const initial = initializeDatabase(databasePath);
    initial.sqlite
      .prepare(
        `INSERT INTO assets (
          id, name, description, media_type, original_filename, original_path,
          mime_type, size_bytes, direct_publish, processing_status,
          review_status, created_at, updated_at
        ) VALUES (?, ?, '', 'image', ?, ?, 'image/png', 3, 0, 'completed',
          'published', ?, ?)`,
      )
      .run(
        "legacy-asset",
        "保留的素材",
        "legacy.png",
        "legacy-asset/original.png",
        Date.now(),
        Date.now(),
      );
    initial.sqlite.exec("DROP TABLE __drizzle_migrations");
    initial.sqlite.close();

    const adopted = initializeDatabase(databasePath);
    expect(
      adopted.sqlite
        .prepare("SELECT name FROM assets WHERE id = ?")
        .get("legacy-asset"),
    ).toEqual({ name: "保留的素材" });
    expect(
      adopted.sqlite
        .prepare("SELECT count(*) AS count FROM __drizzle_migrations")
        .get(),
    ).toEqual({ count: 1 });
    adopted.sqlite.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
