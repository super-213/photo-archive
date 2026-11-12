import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const dataDirectory = path.resolve(
  /* turbopackIgnore: true */ process.env.PHOTO_ARCHIVE_DATA_DIR || ".data",
);
const publicDirectory = path.resolve("public");
if (
  dataDirectory === publicDirectory ||
  dataDirectory.startsWith(`${publicDirectory}${path.sep}`)
) {
  throw new Error("照片数据目录必须位于 public 静态目录之外");
}
export const mediaDirectory = path.join(dataDirectory, "media");
let database: Database.Database | undefined;

export function getDatabase() {
  if (database) return database;
  mkdirSync(mediaDirectory, { recursive: true, mode: 0o700 });
  const db = new Database(path.join(dataDirectory, "archive.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migration (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM schema_migration WHERE version = 1").get())
      return;
    db.exec(`
      CREATE TABLE photo (
        id TEXT PRIMARY KEY, digest TEXT NOT NULL UNIQUE, storage_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL, alt TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        width INTEGER NOT NULL, height INTEGER NOT NULL, mime_type TEXT NOT NULL, file_size INTEGER NOT NULL,
        category TEXT NOT NULL, year TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '', visibility TEXT NOT NULL DEFAULT 'draft' CHECK (visibility IN ('draft','public','private')),
        captured_at TEXT NOT NULL DEFAULT '', camera_make TEXT NOT NULL DEFAULT '', camera_model TEXT NOT NULL DEFAULT '',
        lens_model TEXT NOT NULL DEFAULT '', focal_length TEXT NOT NULL DEFAULT '', aperture TEXT NOT NULL DEFAULT '',
        shutter_speed TEXT NOT NULL DEFAULT '', iso TEXT NOT NULL DEFAULT '', is_sample INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1, uploaded_at TEXT NOT NULL
      );
      CREATE TABLE media_variant (
        photo_id TEXT NOT NULL REFERENCES photo(id) ON DELETE CASCADE, variant TEXT NOT NULL,
        filename TEXT NOT NULL, mime_type TEXT NOT NULL, PRIMARY KEY(photo_id, variant)
      );
      CREATE TABLE tag (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
      CREATE TABLE photo_tag (
        photo_id TEXT NOT NULL REFERENCES photo(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tag(id), PRIMARY KEY(photo_id, tag_id)
      );
      CREATE TABLE project (
        id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL, year TEXT NOT NULL DEFAULT '',
        cover_photo_id TEXT REFERENCES photo(id), status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
        sort_order INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, published_at TEXT
      );
      CREATE TABLE project_photo (
        project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
        photo_id TEXT NOT NULL REFERENCES photo(id), sort_order INTEGER NOT NULL,
        layout_type TEXT NOT NULL DEFAULT 'full' CHECK (layout_type IN ('full','center','pair')),
        caption TEXT NOT NULL DEFAULT '', PRIMARY KEY(project_id, photo_id), UNIQUE(project_id, sort_order)
      );
      CREATE TABLE administrator (user_id TEXT PRIMARY KEY);
      CREATE INDEX photo_public_filter ON photo(visibility, category, year);
      CREATE INDEX project_photo_photo ON project_photo(photo_id);
    `);
    db.prepare("INSERT INTO schema_migration VALUES (1, ?)").run(
      new Date().toISOString(),
    );
  }).immediate();
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM schema_migration WHERE version = 2").get())
      return;
    db.exec(`
      CREATE TABLE project_photo_next (
        project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
        photo_id TEXT NOT NULL REFERENCES photo(id), sort_order INTEGER NOT NULL,
        layout_type TEXT NOT NULL DEFAULT 'full' CHECK (layout_type IN ('full','center','pair','asymmetric','large-small','triptych')),
        caption TEXT NOT NULL DEFAULT '', layout_group TEXT,
        PRIMARY KEY(project_id, photo_id), UNIQUE(project_id, sort_order)
      );
      INSERT INTO project_photo_next(project_id,photo_id,sort_order,layout_type,caption)
        SELECT project_id,photo_id,sort_order,layout_type,caption FROM project_photo;
      DROP TABLE project_photo;
      ALTER TABLE project_photo_next RENAME TO project_photo;
      CREATE INDEX project_photo_photo ON project_photo(photo_id);
    `);
    db.prepare("INSERT INTO schema_migration VALUES (2, ?)").run(
      new Date().toISOString(),
    );
  }).immediate();
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM schema_migration WHERE version = 3").get()) return;
    db.exec(`
      CREATE INDEX photo_public_page ON photo(visibility, uploaded_at DESC, id);
      CREATE INDEX photo_category_page ON photo(visibility, category, uploaded_at DESC, id);
      CREATE INDEX project_public_order ON project(status, sort_order, id);
    `);
    db.prepare("INSERT INTO schema_migration VALUES (3, ?)").run(new Date().toISOString());
  }).immediate();
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM schema_migration WHERE version = 4").get()) return;
    db.exec("ALTER TABLE media_variant ADD COLUMN encoding_version INTEGER NOT NULL DEFAULT 1");
    db.prepare("INSERT INTO schema_migration VALUES (4, ?)").run(new Date().toISOString());
  }).immediate();
  database = db;
  return db;
}
