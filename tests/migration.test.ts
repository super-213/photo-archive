import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("stage-two database migration preserves legacy associations, captions and foreign keys", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "photo-archive-migration-"),
  );
  process.env.PHOTO_ARCHIVE_DATA_DIR = directory;
  const legacy = new Database(path.join(directory, "archive.sqlite"));
  legacy.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE schema_migration(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migration VALUES (1,'2026-11-11');
    CREATE TABLE photo(id TEXT PRIMARY KEY);
    CREATE TABLE project(id TEXT PRIMARY KEY);
    INSERT INTO photo VALUES ('a'),('b'); INSERT INTO project VALUES ('series');
    CREATE TABLE project_photo (
      project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
      photo_id TEXT NOT NULL REFERENCES photo(id), sort_order INTEGER NOT NULL,
      layout_type TEXT NOT NULL DEFAULT 'full' CHECK(layout_type IN ('full','center','pair')),
      caption TEXT NOT NULL DEFAULT '', PRIMARY KEY(project_id,photo_id), UNIQUE(project_id,sort_order)
    );
    CREATE INDEX project_photo_photo ON project_photo(photo_id);
    INSERT INTO project_photo VALUES ('series','a',0,'pair','保留标题'),('series','b',1,'pair','');
  `);
  legacy.close();
  const { getDatabase } = await import("../src/lib/server/database");
  const db = getDatabase();
  try {
    const rows = db
      .prepare("SELECT * FROM project_photo ORDER BY sort_order")
      .all() as {
      photo_id: string;
      caption: string;
      layout_group: string | null;
    }[];
    assert.deepEqual(
      rows.map((row) => row.photo_id),
      ["a", "b"],
    );
    assert.equal(rows[0].caption, "保留标题");
    assert.equal(rows[0].layout_group, null);
    db.prepare(
      "UPDATE project_photo SET layout_type='triptych',layout_group='group-a'",
    ).run();
    assert.deepEqual(db.pragma("foreign_key_check"), []);
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM schema_migration WHERE version=2",
          )
          .get() as { count: number }
      ).count,
      1,
    );
    assert.equal(getDatabase(), db);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
