import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(os.tmpdir(), "photo-archive-performance-"));
process.env.PHOTO_ARCHIVE_DATA_DIR = directory;
const { getDatabase } = await import("../src/lib/server/database");
const { listPhotos, listPhotoPage, listProjects, listProjectCovers, getPublishedProject, getNextPublishedProject } =
  await import("../src/lib/server/store");
const pageRoute = await import("../src/app/api/photos/page/route");
const db = getDatabase();
after(async () => {
  db.close();
  await rm(directory, { recursive: true, force: true });
});

db.transaction(() => {
  const insert = db.prepare(`INSERT INTO photo
    (id,digest,storage_key,title,alt,width,height,mime_type,file_size,category,visibility,uploaded_at)
    VALUES (?,?,?,?,?,1600,1200,'image/jpeg',1000,?,?,?)`);
  for (let index = 0; index < 80; index++) {
    const id = `photo-${String(index).padStart(3, "0")}`;
    insert.run(id, id, id, id, id, index % 2 ? "Street" : "Landscape",
      index < 60 ? "public" : index < 70 ? "private" : "draft", "2026-11-11T12:00:00.000Z");
  }
  db.exec(`INSERT INTO tag(name) VALUES ('标签');
    INSERT INTO photo_tag SELECT id,1 FROM photo;
    INSERT INTO project(id,slug,title,category,cover_photo_id,status,sort_order) VALUES
      ('series-a','series-a','系列甲','Street','photo-000','published',0),
      ('series-b','series-b','系列乙','Street','photo-002','published',0),
      ('series-private','series-private','私有系列','Street','photo-060','published',1),
      ('series-draft','series-draft','草稿系列','Street','photo-000','draft',2);
    INSERT INTO project_photo(project_id,photo_id,sort_order,layout_type)
      SELECT 'series-a',id,ROW_NUMBER() OVER (ORDER BY id)-1,'full' FROM photo WHERE visibility='public';
    INSERT INTO project_photo VALUES ('series-b','photo-002',0,'center','',NULL),
      ('series-private','photo-060',0,'full','',NULL), ('series-draft','photo-000',0,'full','',NULL);`);
})();

test("archive pagination is bounded, stable for tied dates, and excludes private photos", () => {
  const expected = listPhotos().map((photo) => photo.id);
  const first = listPhotoPage("all");
  assert.equal(first.photos.length, 24);
  assert.equal(first.total, 60);
  assert.ok(first.nextCursor);
  // A newly published photo before the cursor must not move existing page boundaries.
  db.prepare(`UPDATE photo SET visibility='public', uploaded_at='2026-11-12T12:00:00.000Z' WHERE id='photo-060'`).run();
  const second = listPhotoPage("all", first.nextCursor!);
  const third = listPhotoPage("all", second.nextCursor!);
  assert.equal(third.nextCursor, null);
  assert.deepEqual([...first.photos, ...second.photos, ...third.photos].map((photo) => photo.id), expected);
  db.prepare("UPDATE photo SET visibility='private' WHERE id='photo-060'").run();
  const street = listPhotoPage("Street");
  assert.equal(street.total, 30);
  assert.ok(street.photos.every((photo) => photo.category === "Street" && photo.visibility === "public"));
  assert.deepEqual(street.photos[0].tags, ["标签"]);
  assert.throws(() => listPhotoPage("all", "invalid"), /分页位置无效/);
  assert.throws(() => listPhotoPage("all", Buffer.from('[1,2]').toString("base64url")), /分页位置无效/);
});

test("bounded archive API validates cursors and legacy filters do not restrict results", async () => {
  const response = await pageRoute.GET(new Request("http://localhost/api/photos/page?year=1990&camera=old"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  const page = await response.json();
  assert.equal(page.photos.length, 24);
  assert.equal(page.total, 60);
  const unknown = await pageRoute.GET(new Request("http://localhost/api/photos/page?category=unknown"));
  assert.equal((await unknown.json()).total, 60);
  const invalid = await pageRoute.GET(new Request("http://localhost/api/photos/page?cursor=invalid"));
  assert.equal(invalid.status, 400);
});

test("public project queries preserve layouts, cover metadata and next-series order", () => {
  const projects = listProjects();
  const covers = listProjectCovers();
  assert.equal(projects.length, 2);
  assert.deepEqual(covers.map((cover) => cover.slug), projects.map((project) => project.slug));
  assert.equal(covers[0].title, "系列甲");
  assert.equal(covers[0].cover.title, "photo-000");
  assert.equal(projects[0].photos.length, 60);
  assert.equal(projects[0].layouts.length, 60);
  assert.deepEqual(getPublishedProject("series-a"), projects[0]);
  assert.equal(getPublishedProject("series-private"), undefined);
  assert.equal(getPublishedProject("series-draft"), undefined);
  assert.equal(getNextPublishedProject(projects[0])?.slug, "series-b");
  assert.equal(getNextPublishedProject(projects[1])?.slug, "series-a");
});

test("query count remains bounded as photo and project membership grow", () => {
  const prepare = db.prepare;
  let queries = 0;
  db.prepare = ((...args: Parameters<typeof prepare>) => {
    queries++;
    return prepare.apply(db, args);
  }) as typeof prepare;
  try {
    listPhotos();
    assert.equal(queries, 1);
    queries = 0;
    listProjects();
    assert.equal(queries, 2);
    queries = 0;
    listProjectCovers();
    assert.equal(queries, 1);
    queries = 0;
    listPhotoPage("all");
    assert.equal(queries, 2);
  } finally {
    db.prepare = prepare;
  }
});
