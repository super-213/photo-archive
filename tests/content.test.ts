import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { after, test } from "node:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const directory = await mkdtemp(path.join(os.tmpdir(), "photo-archive-test-"));
process.env.PHOTO_ARCHIVE_DATA_DIR = directory;
process.env.PHOTO_ARCHIVE_ORIGINAL_DOWNLOAD = "false";
process.env.PHOTO_ARCHIVE_COPYRIGHT_AUTHOR = "测试作者";
process.env.PHOTO_ARCHIVE_COPYRIGHT_NOTICE = "© 测试作者 保留所有权利";
delete process.env.BETTER_AUTH_URL;
const { importPhoto, rebuildPhotoPreviews, getMediaRecord, readMedia, maxUploadBytes } =
  await import("../src/lib/server/media");
const {
  listPhotos,
  getPhoto,
  updatePhoto,
  listProjects,
  listProjectCovers,
  saveProject,
  deleteProject,
} = await import("../src/lib/server/store");
const { photoInput, projectInput } =
  await import("../src/lib/server/validation");
const { getDatabase, mediaDirectory } =
  await import("../src/lib/server/database");
const { createAuth, getAuth } = await import("../src/lib/server/auth");
const mediaRoute = await import("../src/app/media/[id]/[variant]/route");
const uploadRoute = await import("../src/app/api/admin/photos/route");
const projectRoute = await import("../src/app/api/admin/projects/route");
const projectDetailRoute = await import("../src/app/api/admin/projects/[id]/route");
const photoRoute = await import("../src/app/api/admin/photos/[id]/route");
const authRoute = await import("../src/app/api/auth/[...all]/route");
const publicPhotoRoute = await import("../src/app/api/photos/route");
const origin = "http://localhost:3456";
const auth = await getAuth();
const setup = createAuth(true);
const password = "test-only-password-9381!";
const signup = await setup.api.signUpEmail({
  body: { name: "Test admin", email: "admin@example.test", password },
});
getDatabase()
  .prepare("INSERT INTO administrator VALUES (?)")
  .run(signup.user.id);
const login = await auth.handler(
  new Request(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify({ email: "admin@example.test", password }),
  }),
);
assert.equal(login.status, 200);
const cookie = login.headers
  .getSetCookie()
  .map((entry) => entry.split(";")[0])
  .join("; ");
assert.ok(cookie.includes("session_token"));
const authHeaders = {
  cookie,
  origin,
  host: "localhost:3456",
  "Content-Type": "application/json",
};
after(async () => {
  getDatabase().close();
  await rm(directory, { recursive: true, force: true });
});

const buffer = await sharp({
  create: { width: 640, height: 320, channels: 3, background: "#4e615b" },
})
  .withMetadata({ orientation: 6 })
  .withExif({
    IFD0: { Make: "Fixture", Model: "Test Camera" },
    IFD2: {
      DateTimeOriginal: "2024:05:06 07:08:09",
      FNumber: "28/10",
      ExposureTime: "1/125",
    },
  })
  .jpeg()
  .toBuffer();
let photoId = "";
let projectId = "";

test("uploads normalize orientation, extract EXIF, strip preview metadata and begin as drafts", async () => {
  const result = await importPhoto(buffer, "fixture.jpg");
  photoId = result.photo.id;
  assert.equal(result.photo.visibility, "draft");
  assert.equal(result.photo.width, 320);
  assert.equal(result.photo.height, 640);
  assert.equal(result.photo.cameraModel, "Test Camera");
  assert.equal(result.photo.capturedAt, "2024-05-06");
  assert.equal(listPhotos().length, 0);
  for (const variant of ["thumbnail", "preview", "lightbox"]) {
    const bytes = await readMedia(getMediaRecord(photoId, variant)!);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.orientation, undefined);
  }
  assert.equal(getMediaRecord(photoId, "original"), undefined);
  const record = getMediaRecord(photoId, "lightbox")!;
  assert.deepEqual((await readdir(path.join(mediaDirectory, record.storage_key))).sort(),
    ["lightbox.webp", "preview.webp", "thumbnail.webp"]);
});

test("duplicate and concurrent uploads reuse one photo and preserve manual metadata", async () => {
  const photo = getPhoto(photoId)!;
  updatePhoto(
    photoId,
    photoInput.parse({
      ...photo,
      title: "Manual title",
      cameraModel: "Manual camera",
      tags: ["街头", "街头", "样片"],
    }),
  );
  const duplicate = await importPhoto(buffer, "different-name.jpg");
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.photo.title, "Manual title");
  assert.equal(duplicate.photo.cameraModel, "Manual camera");
  assert.equal(duplicate.photo.tags.length, 2);
  const concurrentBuffer = await sharp({
    create: { width: 120, height: 90, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const results = await Promise.all([
    importPhoto(concurrentBuffer, "a.png"),
    importPhoto(concurrentBuffer, "b.png"),
  ]);
  assert.equal(results[0].photo.id, results[1].photo.id);
  assert.equal(listPhotos(false).length, 2);
  assert.equal((await readdir(mediaDirectory)).length, 2);
});

test("anonymous users cannot read private previews, originals, or mutate admin data", async () => {
  for (const variant of [
    "grid",
    "thumbnail",
    "original",
    "../../archive.sqlite",
  ]) {
    const response = await mediaRoute.GET(
      new Request(`${origin}/media/${photoId}/${variant}`),
      { params: Promise.resolve({ id: photoId, variant }) },
    );
    assert.equal(response.status, 404);
    assert.match(response.headers.get("Cache-Control")!, /no-store/);
  }
  assert.equal(
    (await uploadRoute.GET(new Request(`${origin}/api/admin/photos`))).status,
    401,
  );
  assert.equal(
    (
      await projectRoute.POST(
        new Request(`${origin}/api/admin/projects`, {
          method: "POST",
          body: "{}",
        }),
      )
    ).status,
    401,
  );
  assert.equal((await publicPhotoRoute.GET().json()).length, 0);
});

test("original downloads are disabled for every visibility, including administrator GET and HEAD requests", async () => {
  const previous = getPhoto(photoId)!;
  try {
    for (const visibility of ["draft", "private", "public"] as const) {
      updatePhoto(photoId, photoInput.parse({ ...getPhoto(photoId), visibility }));
      for (const variant of ["original", "original.jpg", "original.webp", "download", "download.jpg", "download.webp"]) {
        for (const method of ["GET", "HEAD"] as const) {
          for (const session of ["", cookie]) {
            const response = await mediaRoute[method](new Request(`${origin}/media/${photoId}/${variant}?download=1`, {
              method, headers: { cookie: session, host: "localhost:3456", range: "bytes=0-99", "if-none-match": "*" },
            }), { params: Promise.resolve({ id: photoId, variant }) });
            assert.equal(response.status, 404);
            assert.equal((await response.arrayBuffer()).byteLength, 0);
            assert.match(response.headers.get("cache-control")!, /no-store/);
          }
        }
      }
    }
    assert.ok(!(await readdir(path.join(mediaDirectory, getMediaRecord(photoId, "lightbox")!.storage_key)))
      .some((name) => name.startsWith(".copyright-")));
  } finally {
    updatePhoto(photoId, photoInput.parse({ ...getPhoto(photoId), visibility: previous.visibility }));
  }
});

test("publishing validates membership, covers, and public status", async () => {
  const input = projectInput.parse({
    version: 0,
    slug: "test-series",
    title: "Test series",
    subtitle: "",
    description: "",
    category: "Street",
    year: "2024",
    coverPhotoId: photoId,
    status: "published",
    sortOrder: 0,
    items: [{ photoId, layoutType: "full", caption: "" }],
  });
  assert.throws(() => saveProject(null, input), /公开状态/);
  const photo = getPhoto(photoId)!;
  updatePhoto(photoId, photoInput.parse({ ...photo, visibility: "public" }));
  assert.throws(
    () => saveProject(null, { ...input, coverPhotoId: "missing" }),
    /封面/,
  );
  const project = saveProject(null, input);
  projectId = project.id;
  assert.equal(listProjects().length, 1);
  assert.equal(listPhotos().length, 1);
  const response = await mediaRoute.GET(
    new Request(`${origin}/media/${photoId}/grid`),
    { params: Promise.resolve({ id: photoId, variant: "grid" }) },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-cache");
  assert.ok(response.headers.get("etag"));
  await response.arrayBuffer();
  const original = await mediaRoute.GET(new Request(`${origin}/media/${photoId}/original`), {
    params: Promise.resolve({ id: photoId, variant: "original" }),
  });
  assert.equal(original.status, 404);
  assert.match(original.headers.get("cache-control")!, /no-store/);
  assert.equal((await original.arrayBuffer()).byteLength, 0);
});

test("photo editing accepts empty or omitted titles and alt text on published photos", async () => {
  const original = getPhoto(photoId)!;
  for (const blank of ["   ", undefined]) {
    const current = getPhoto(photoId)!;
    const response = await photoRoute.PUT(
      new Request(`${origin}/api/admin/photos/${photoId}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ ...current, title: blank, alt: blank }),
      }),
      { params: Promise.resolve({ id: photoId }) },
    );
    assert.equal(response.status, 200);
    const { photo } = await response.json();
    assert.equal(photo.title, "");
    assert.equal(photo.alt, "");
    assert.equal(listPhotos().find((item) => item.id === photoId)!.title, "");
    assert.equal(listProjects()[0].photos[0].alt, "");
  }
  updatePhoto(photoId, photoInput.parse({ ...original, version: getPhoto(photoId)!.version }));
});

async function patchPhoto(body: unknown, headers: HeadersInit = authHeaders, id = photoId) {
  return photoRoute.PATCH(new Request(`${origin}/api/admin/photos/${id}`, {
    method: "PATCH", headers, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
}

test("incremental title edits preserve omitted fields and do not rewrite tags or other columns", async () => {
  const before = getPhoto(photoId)!;
  const db = getDatabase();
  const prepare = db.prepare;
  const statements: string[] = [];
  db.prepare = ((...args: Parameters<typeof prepare>) => {
    statements.push(args[0]);
    return prepare.apply(db, args);
  }) as typeof prepare;
  try {
    const response = await patchPhoto({ version: before.version, title: "仅更新标题" });
    assert.equal(response.status, 200);
    const { photo, unpublished } = await response.json();
    assert.deepEqual(photo, { ...before, title: "仅更新标题", version: before.version + 1 });
    assert.equal(unpublished, 0);
    const writes = statements.filter((sql) => /^(UPDATE|INSERT|DELETE)\s/i.test(sql));
    assert.deepEqual(writes, ["UPDATE photo SET title=@title, version=version+1 WHERE id=@id"]);
  } finally {
    db.prepare = prepare;
    updatePhoto(photoId, photoInput.parse({ ...before, version: getPhoto(photoId)!.version }));
  }
});

test("incremental saves distinguish omitted fields, explicit clearing, tag changes and no-ops", async () => {
  const original = getPhoto(photoId)!;
  try {
    let before = getPhoto(photoId)!;
    let response = await patchPhoto({ version: before.version, alt: "保留的替代文本", tags: ["甲", "乙", "甲"] });
    assert.equal(response.status, 200);
    let { photo } = await response.json();
    assert.equal(photo.title, before.title);
    assert.deepEqual(photo.tags, ["乙", "甲"]);
    before = photo;
    response = await patchPhoto({ version: before.version, tags: ["甲", "乙"] });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).photo, before);
    response = await patchPhoto({ version: before.version });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).photo, before);
    response = await patchPhoto({ version: before.version, title: "   ", tags: [] });
    assert.equal(response.status, 200);
    photo = (await response.json()).photo;
    assert.equal(photo.title, "");
    assert.equal(photo.alt, "保留的替代文本");
    assert.equal(photo.category, before.category);
    assert.deepEqual(photo.tags, []);
    assert.equal(photo.version, before.version + 1);
    assert.equal((await patchPhoto({ version: before.version, location: "过期编辑" })).status, 409);
  } finally {
    updatePhoto(photoId, photoInput.parse({ ...original, version: getPhoto(photoId)!.version }));
  }
});

test("PATCH enforces field validation, administrator access, origin checks and missing-photo errors", async () => {
  const before = getPhoto(photoId)!;
  for (const changes of [
    { title: "缺少版本号" }, { version: before.version, title: null },
    { version: before.version, category: "unknown" }, { version: before.version, capturedAt: "2026-02-30" },
    { version: before.version, tags: null }, { version: before.version, storage_key: "unsafe" },
  ]) assert.equal((await patchPhoto(changes)).status, 400);
  assert.equal((await patchPhoto({ version: before.version }, { "Content-Type": "application/json" })).status, 401);
  assert.equal((await patchPhoto({ version: before.version }, { ...authHeaders, origin: "https://evil.example" })).status, 403);
  assert.equal((await patchPhoto({ version: before.version }, authHeaders, "missing-photo")).status, 404);
  assert.deepEqual(getPhoto(photoId), before);
});

test("series URLs are generated uniquely and remain stable when editing with an empty slug", async () => {
  const template = listProjects(false).find((project) => project.id === projectId)!;
  const created: { id: string; version: number }[] = [];
  try {
    for (const title of ["Same title", "Same title", "山水之间", "山水之间"]) {
      const response = await projectRoute.POST(new Request(`${origin}/api/admin/projects`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ ...template, version: 0, slug: "", title }),
      }));
      assert.equal(response.status, 201);
      const project = await response.json();
      created.push(project);
      assert.match(project.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.equal(listProjects().find((item) => item.id === project.id)!.slug, project.slug);

      const edited = await projectDetailRoute.PUT(new Request(`${origin}/api/admin/projects/${project.id}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ ...project, title: "修改后的名称", slug: undefined }),
      }), { params: Promise.resolve({ id: project.id }) });
      assert.equal(edited.status, 200);
      const updated = await edited.json();
      created[created.length - 1] = updated;
      assert.equal(updated.slug, project.slug);
    }
    const slugs = listProjects(false).filter((project) => created.some((item) => item.id === project.id))
      .map((project) => project.slug);
    assert.equal(new Set(slugs).size, created.length);
    const omitted = saveProject(null, projectInput.parse({ ...template, version: 0, slug: undefined }));
    created.push(omitted);
    assert.ok(omitted.slug);
    assert.throws(() => saveProject(null, projectInput.parse({ ...template, version: 0 })), /网址标识已被/);
    assert.equal(projectInput.safeParse({ ...template, slug: "Invalid / URL" }).success, false);
  } finally {
    for (const project of created) deleteProject(project.id, project.version);
  }
});

test("cover art direction persists across reordering and legacy updates", () => {
  const current = listProjects(false).find((project) => project.id === projectId)!;
  assert.equal(current.coverRatio, "original");
  const updated = saveProject(current.id, projectInput.parse({
    ...current, coverLayout: "offset", coverRatio: "portrait", coverFocusX: 0, coverFocusY: 100,
  }));
  const { coverLayout, coverRatio, coverFocusX, coverFocusY, ...legacy } = updated;
  const reordered = saveProject(updated.id, projectInput.parse({ ...legacy, sortOrder: 42 }));
  assert.deepEqual(
    [reordered.coverLayout, reordered.coverRatio, reordered.coverFocusX, reordered.coverFocusY],
    [coverLayout, coverRatio, coverFocusX, coverFocusY],
  );
  const cover = listProjectCovers().find((project) => project.slug === reordered.slug)!;
  assert.deepEqual(
    [cover.coverLayout, cover.coverRatio, cover.coverFocusX, cover.coverFocusY],
    ["offset", "portrait", 0, 100],
  );
  for (const invalid of [{ coverLayout: "unknown" }, { coverRatio: "square" }, { coverFocusX: -1 }, { coverFocusY: 101 }])
    assert.equal(projectInput.safeParse({ ...reordered, ...invalid }).success, false);
});

test("photo associations have independent ordering and project deletion retains source photos", () => {
  const first = listProjects(false).find((item) => item.id === projectId)!;
  const otherPhoto = listPhotos(false).find((photo) => photo.id !== photoId)!;
  const other = saveProject(
    null,
    projectInput.parse({
      ...first,
      version: 0,
      slug: "second-series",
      status: "draft",
      items: [
        ...first.items,
        { photoId: otherPhoto.id, layoutType: "center", caption: "" },
      ],
    }),
  );
  const reordered = saveProject(
    other.id,
    projectInput.parse({ ...other, items: [...other.items].reverse() }),
  );
  assert.equal(reordered.photos[0].id, otherPhoto.id);
  assert.equal(
    listProjects(false).find((item) => item.id === projectId)!.photos[0].id,
    photoId,
  );
  deleteProject(other.id, reordered.version);
  assert.ok(getPhoto(otherPhoto.id));
  assert.ok(getMediaRecord(otherPhoto.id, "lightbox"));
  assert.equal(getMediaRecord(otherPhoto.id, "original"), undefined);
});

test("withdrawing a photo atomically unpublishes affected projects and blocks stale edits", async () => {
  const before = getPhoto(photoId)!;
  const saved = await patchPhoto({ version: before.version, visibility: "private" });
  assert.equal(saved.status, 200);
  const { unpublished } = await saved.json();
  assert.equal(unpublished, 1);
  assert.equal(listProjects().length, 0);
  assert.equal(listPhotos().length, 0);
  assert.throws(
    () => updatePhoto(photoId, photoInput.parse(before)),
    /其他操作更新/,
  );
  const response = await mediaRoute.GET(
    new Request(`${origin}/media/${photoId}/grid`),
    { params: Promise.resolve({ id: photoId, variant: "grid" }) },
  );
  assert.equal(response.status, 404);
});

test("admin sessions, CSRF checks and registration restrictions protect write endpoints", async () => {
  assert.equal(
    (
      await uploadRoute.GET(
        new Request(`${origin}/api/admin/photos`, {
          headers: { cookie, host: "localhost:3456" },
        }),
      )
    ).status,
    200,
  );
  const photo = getPhoto(photoId)!;
  const badOrigin = await photoRoute.PUT(
    new Request(`${origin}/api/admin/photos/${photoId}`, {
      method: "PUT",
      headers: { ...authHeaders, origin: "https://other.example" },
      body: JSON.stringify(photo),
    }),
    { params: Promise.resolve({ id: photoId }) },
  );
  assert.equal(badOrigin.status, 403);
  const invalid = await photoRoute.PUT(
    new Request(`${origin}/api/admin/photos/${photoId}`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ ...photo, year: "invalid" }),
    }),
    { params: Promise.resolve({ id: photoId }) },
  );
  assert.equal(invalid.status, 400);
  const registration = await authRoute.POST(
    new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: authHeaders,
      body: "{}",
    }),
  );
  assert.equal(registration.status, 404);
  const privateMedia = await mediaRoute.GET(
    new Request(`${origin}/media/${photoId}/preview.webp`, {
      headers: { cookie, host: "localhost:3456" },
    }),
    { params: Promise.resolve({ id: photoId, variant: "preview.webp" }) },
  );
  assert.equal(privateMedia.status, 200);
  await privateMedia.arrayBuffer();
});

test("invalid images and oversized payloads fail cleanly and allow subsequent uploads", async () => {
  const count = listPhotos(false).length;
  await assert.rejects(
    importPhoto(Buffer.from("not a photo"), "fake.jpg"),
    /无法读取/,
  );
  await assert.rejects(
    importPhoto(Buffer.alloc(maxUploadBytes + 1), "large.jpg"),
    /256 MiB/,
  );
  assert.equal(listPhotos(false).length, count);
  assert.ok(
    !(await readdir(mediaDirectory)).some((name) =>
      name.startsWith(".upload-"),
    ),
  );
  const data = new FormData();
  data.set(
    "file",
    new File([new Uint8Array(buffer)], "retry.jpg", { type: "image/jpeg" }),
  );
  const retry = await uploadRoute.POST(
    new Request(`http://127.0.0.1:3456/api/admin/photos`, {
      method: "POST",
      headers: { cookie, origin, host: "localhost:3456" },
      body: data,
    }),
  );
  assert.equal(retry.status, 201);
  assert.equal((await retry.json()).duplicate, true);
});

test("media validators reduce transfer and cannot bypass visibility or original authorization", async () => {
  const photo = getPhoto(photoId)!;
  updatePhoto(photoId, photoInput.parse({ ...photo, visibility: "public" }));
  const context = { params: Promise.resolve({ id: photoId, variant: "grid" }) };
  const url = `${origin}/media/${photoId}/grid`;
  const response = await mediaRoute.GET(new Request(url), context);
  const etag = response.headers.get("etag")!;
  assert.equal(response.status, 200);
  assert.ok(etag);
  const body = await response.arrayBuffer();
  assert.equal(Number(response.headers.get("content-length")), body.byteLength);
  const cached = await mediaRoute.GET(new Request(url, {
    headers: { "if-none-match": `"older", W/${etag}` },
  }), context);
  assert.equal(cached.status, 304);
  assert.equal((await cached.arrayBuffer()).byteLength, 0);
  const head = await mediaRoute.HEAD(new Request(url, { method: "HEAD" }), context);
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get("content-length")), body.byteLength);
  assert.equal((await head.arrayBuffer()).byteLength, 0);

  updatePhoto(photoId, photoInput.parse({ ...getPhoto(photoId)!, visibility: "private" }));
  for (const method of ["GET", "HEAD"]) {
    const revoked = await mediaRoute.GET(new Request(url, {
      method, headers: { "if-none-match": etag },
    }), context);
    assert.equal(revoked.status, 404);
    assert.match(revoked.headers.get("cache-control")!, /no-store/);
  }
  const original = await mediaRoute.GET(new Request(`${origin}/media/${photoId}/original`, {
    headers: { "if-none-match": "*" },
  }), { params: Promise.resolve({ id: photoId, variant: "original" }) });
  assert.equal(original.status, 404);
  const privateImage = await mediaRoute.GET(new Request(url, { headers: { cookie, host: "localhost:3456", "if-none-match": "*" } }), context);
  assert.equal(privateImage.status, 200);
  assert.match(privateImage.headers.get("cache-control")!, /no-store/);
  await privateImage.arrayBuffer();
});

test("admin JSON requests enforce byte limits with and without Content-Length", async () => {
  const url = `${origin}/api/admin/photos/${photoId}`;
  const context = { params: Promise.resolve({ id: photoId }) };
  const oversized = JSON.stringify({ description: "x".repeat(4 * 1024 * 1024) });
  for (const length of [undefined, "1", String(oversized.length)]) {
    const headers: Record<string, string> = { ...authHeaders };
    if (length) headers["content-length"] = length;
    const response = await photoRoute.PUT(new Request(url, {
      method: "PUT", headers, body: oversized,
    }), context);
    assert.equal(response.status, 413);
  }
  const malformed = await photoRoute.PUT(new Request(url, {
    method: "PUT", headers: authHeaders, body: "{",
  }), context);
  assert.equal(malformed.status, 400);
});

test("upload processing is bounded and releases capacity after malformed uploads", async () => {
  function heldUpload() {
    let close!: () => void;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => { started = resolve; });
    const body = new ReadableStream<Uint8Array>({
      start(controller) { close = () => controller.close(); },
      pull() { started(); },
    }, { highWaterMark: 0 });
    const request = new Request(`${origin}/api/admin/photos`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "multipart/form-data; boundary=held" },
      body,
      duplex: "half",
    } as RequestInit);
    return { response: uploadRoute.POST(request), reading, close };
  }
  const first = heldUpload();
  const second = heldUpload();
  await Promise.all([first.reading, second.reading]);
  try {
    const busy = await uploadRoute.POST(new Request(`${origin}/api/admin/photos`, {
      method: "POST", headers: authHeaders, body: "{}",
    }));
    assert.equal(busy.status, 429);
  } finally {
    first.close();
    second.close();
    await Promise.all([first.response, second.response]);
  }
  const data = new FormData();
  data.set("file", new File([new Uint8Array(buffer)], "retry.jpg", { type: "image/jpeg" }));
  const retry = await uploadRoute.POST(new Request(`${origin}/api/admin/photos`, {
    method: "POST", headers: { cookie, origin, host: "localhost:3456" }, body: data,
  }));
  assert.equal(retry.status, 201);
});

test("previews use lossy WebP at the correct sizes and rebuild legacy files without storing originals", async () => {
  const pixels = Buffer.alloc(1600 * 1000 * 3);
  for (let index = 0; index < pixels.length; index++) pixels[index] = (index * 17 + Math.floor(index / 59)) % 256;
  const source = await sharp(pixels, { raw: { width: 1600, height: 1000, channels: 3 } })
    .jpeg({ quality: 98, chromaSubsampling: "4:4:4" }).toBuffer();
  const { photo } = await importPhoto(source, "高质量样片.jpg");
  assert.equal(photo.title, "高质量样片");
  assert.ok(photo.previewSrc);
  for (const [variant, width] of [["thumbnail", 420], ["preview", 840], ["lightbox", 2560]] as const) {
    const encoded = await readMedia(getMediaRecord(photo.id, variant)!);
    const metadata = await sharp(encoded).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, Math.min(width, 1600));
    assert.equal(metadata.height, Math.round(1000 * Math.min(1, width / 1600)));
    assert.ok(encoded.includes(Buffer.from("VP8 ")), `${variant} must use lossy WebP`);
  }
  updatePhoto(photo.id, photoInput.parse({ ...photo, title: "人工标题", tags: ["保留"] }));
  const record = getMediaRecord(photo.id, "preview")!;
  const legacy = await sharp(source).resize({ width: 840, height: 840, fit: "inside" }).webp({ lossless: true }).toBuffer();
  await writeFile(path.join(mediaDirectory, record.storage_key, record.filename), legacy);
  getDatabase().prepare("UPDATE media_variant SET encoding_version=4 WHERE photo_id=? AND variant='preview'").run(photo.id);
  assert.equal(await rebuildPhotoPreviews(photo.id), true);
  assert.equal(await rebuildPhotoPreviews(photo.id), false);
  const rebuilt = await readMedia(getMediaRecord(photo.id, "preview")!);
  assert.ok(rebuilt.includes(Buffer.from("VP8 ")));
  assert.ok(rebuilt.length < legacy.length);
  assert.equal(getMediaRecord(photo.id, "original"), undefined);
  assert.equal(getPhoto(photo.id)!.title, "人工标题");
  assert.deepEqual(getPhoto(photo.id)!.tags, ["保留"]);
  getDatabase().prepare("DELETE FROM photo WHERE id=?").run(photo.id);
  await rm(path.join(mediaDirectory, record.storage_key), { recursive: true, force: true });
});

test("streamed uploads above 80 MiB keep only displays and a source digest, with range support", async () => {
  const boundary = "large-photo-fixture";
  const padding = Buffer.alloc(1024 * 1024);
  const hash = createHash("sha256");
  async function* chunks() {
    yield Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="大幅原片.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`);
    hash.update(buffer);
    yield buffer;
    for (let index = 0; index < 81; index++) {
      hash.update(padding);
      yield padding;
    }
    yield Buffer.from(`\r\n--${boundary}--\r\n`);
  }
  const uploaded = await uploadRoute.POST(new Request(`${origin}/api/admin/photos`, {
    method: "POST",
    headers: { cookie, origin, host: "localhost:3456", "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: Readable.toWeb(Readable.from(chunks())),
    duplex: "half",
  } as RequestInit));
  assert.equal(uploaded.status, 201);
  const { photo } = await uploaded.json();
  assert.equal(photo.title, "大幅原片");
  assert.equal(getMediaRecord(photo.id, "original"), undefined);
  const record = getMediaRecord(photo.id, "lightbox")!;
  const stored = getDatabase().prepare("SELECT digest FROM photo WHERE id=?").get(photo.id) as { digest: string };
  assert.equal(stored.digest, hash.digest("hex"));
  assert.deepEqual((await readdir(path.join(mediaDirectory, record.storage_key))).sort(),
    ["lightbox.webp", "preview.webp", "thumbnail.webp"]);
  updatePhoto(photo.id, photoInput.parse({ ...photo, visibility: "public" }));
  const original = await mediaRoute.GET(new Request(`${origin}/media/${photo.id}/original`), {
    params: Promise.resolve({ id: photo.id, variant: "original" }),
  });
  assert.equal(original.status, 404);
  assert.equal((await original.arrayBuffer()).byteLength, 0);
  const url = `${origin}/media/${photo.id}/lightbox.webp`;
  const context = { params: Promise.resolve({ id: photo.id, variant: "lightbox.webp" }) };
  const display = await mediaRoute.GET(new Request(url), context);
  assert.equal(display.status, 200);
  const downloadBytes = await readMedia(getMediaRecord(photo.id, "lightbox")!);
  assert.equal(getMediaRecord(photo.id, "download"), undefined);
  assert.deepEqual(Buffer.from(await display.arrayBuffer()), downloadBytes);
  const partial = await mediaRoute.GET(new Request(url, { headers: { range: "bytes=0-99" } }), context);
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), `bytes 0-99/${downloadBytes.length}`);
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()), downloadBytes.subarray(0, 100));
  const invalid = await mediaRoute.GET(new Request(url, { headers: { range: "bytes=999999999-" } }), context);
  assert.equal(invalid.status, 416);
  updatePhoto(photo.id, photoInput.parse({ ...getPhoto(photo.id)!, visibility: "private" }));
  assert.equal((await mediaRoute.GET(new Request(url, { headers: { range: "bytes=0-99" } }), context)).status, 404);
  assert.ok(!(await readdir(mediaDirectory)).some((name) => name.startsWith(".upload-")));
  getDatabase().prepare("DELETE FROM photo WHERE id=?").run(photo.id);
  await rm(path.join(mediaDirectory, record.storage_key), { recursive: true, force: true });
});

test("streaming multipart rejects excessive files, oversized and interrupted uploads cleanly", async () => {
  const multiple = new FormData();
  multiple.append("file", new File([new Uint8Array(buffer)], "a.jpg"));
  multiple.append("file", new File([new Uint8Array(buffer)], "b.jpg"));
  const response = await uploadRoute.POST(new Request(`${origin}/api/admin/photos`, {
    method: "POST", headers: { cookie, origin, host: "localhost:3456" }, body: multiple,
  }));
  assert.equal(response.status, 400);
  const wrongField = new FormData();
  wrongField.set("unexpected", new File([new Uint8Array(buffer)], "photo.jpg"));
  const invalidField = await uploadRoute.POST(new Request(`${origin}/api/admin/photos`, {
    method: "POST", headers: { cookie, origin, host: "localhost:3456" }, body: wrongField,
  }));
  assert.equal(invalidField.status, 400);
  const boundary = "too-large-fixture";
  let cancelled = false;
  async function* chunks() {
    try {
      yield Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.jpg"\r\n\r\n`);
      const chunk = Buffer.alloc(1024 * 1024);
      for (let index = 0; index < 258; index++) yield chunk;
      yield Buffer.from(`\r\n--${boundary}--\r\n`);
    } finally {
      cancelled = true;
    }
  }
  const oversized = await uploadRoute.POST(new Request(`${origin}/api/admin/photos`, {
    method: "POST",
    headers: { cookie, origin, host: "localhost:3456", "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: Readable.toWeb(Readable.from(chunks())), duplex: "half",
  } as RequestInit));
  assert.equal(oversized.status, 413);
  assert.equal(cancelled, true);
  const interrupted = await uploadRoute.POST(new Request(`${origin}/api/admin/photos`, {
    method: "POST",
    headers: { cookie, origin, host: "localhost:3456", "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="partial.jpg"\r\n\r\npartial`,
  }));
  assert.equal(interrupted.status, 400);
  assert.ok(!(await readdir(mediaDirectory)).some((name) => name.startsWith(".upload-")));
});

test("large-sensor JPEGs retain their display colour profiles without storing originals", async () => {
  const source = await sharp({ create: { width: 12000, height: 10000, channels: 3, background: "#d83a72" } })
    .withIccProfile("p3").jpeg({ quality: 95 }).toBuffer();
  const { photo } = await importPhoto(source, "120-megapixel.jpg");
  assert.equal(photo.width * photo.height, 120_000_000);
  assert.equal(getMediaRecord(photo.id, "original"), undefined);
  const display = getMediaRecord(photo.id, "lightbox")!;
  const sourceProfile = (await sharp(source).metadata()).icc;
  const preview = await sharp(await readMedia(getMediaRecord(photo.id, "lightbox")!)).metadata();
  assert.deepEqual(preview.icc, sourceProfile);
  assert.equal(preview.exif, undefined);
  assert.equal(Math.max(preview.width!, preview.height!), 2560);
  getDatabase().prepare("DELETE FROM photo WHERE id=?").run(photo.id);
  await rm(path.join(mediaDirectory, display.storage_key), { recursive: true, force: true });
});

test("sign-out revokes the server session", async () => {
  const logout = await auth.handler(
    new Request(`${origin}/api/auth/sign-out`, {
      method: "POST",
      headers: authHeaders,
      body: "{}",
    }),
  );
  assert.equal(logout.status, 200);
  assert.equal(
    (
      await uploadRoute.GET(
        new Request(`${origin}/api/admin/photos`, {
          headers: { cookie, host: "localhost:3456" },
        }),
      )
    ).status,
    401,
  );
});

test("project conflicts and invalid calendar dates are rejected before writes", () => {
  const current = listProjects(false).find(
    (project) => project.id === projectId,
  )!;
  const updated = saveProject(
    current.id,
    projectInput.parse({ ...current, title: "Updated series" }),
  );
  assert.throws(
    () =>
      saveProject(
        current.id,
        projectInput.parse({ ...current, title: "Stale update" }),
      ),
    /其他操作更新/,
  );
  assert.equal(
    listProjects(false).find((project) => project.id === projectId)!.title,
    updated.title,
  );
  assert.equal(
    photoInput.safeParse({ ...getPhoto(photoId)!, capturedAt: "2024-02-31" })
      .success,
    false,
  );
});

test("login rate limits remain active", async () => {
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await auth.handler(
      new Request(`${origin}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@example.test",
          password: "incorrect-password",
        }),
      }),
    );
    statuses.push(response.status);
  }
  assert.ok(statuses.includes(429));
});

test("AVIF uploads retain their source media type without storing originals and SVG is rejected", async () => {
  const avif = await sharp({
    create: { width: 64, height: 40, channels: 3, background: "blue" },
  })
    .avif()
    .toBuffer();
  const result = await importPhoto(avif, "fixture.avif");
  assert.equal(
    (getDatabase().prepare("SELECT mime_type FROM photo WHERE id=?").get(result.photo.id) as { mime_type: string }).mime_type,
    "image/avif",
  );
  await assert.rejects(
    importPhoto(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"></svg>',
      ),
      "unsafe.svg",
    ),
    /单帧/,
  );
});

test("editorial groups persist independently and preserve every association during reorder", async () => {
  for (let index = 0; index < 4; index++) {
    const bytes = await sharp({
      create: {
        width: 100 + index,
        height: 80,
        channels: 3,
        background: "green",
      },
    })
      .png()
      .toBuffer();
    await importPhoto(bytes, `group-fixture-${index}.png`);
  }
  const photos = listPhotos(false);
  for (const photo of photos)
    updatePhoto(photo.id, photoInput.parse({ ...photo, visibility: "public" }));
  const items = photos.map((photo, index) => ({
    photoId: photo.id,
    caption: `caption-${index}`,
    layoutType:
      index < 2 ? "asymmetric" : index < 4 ? "large-small" : "triptych",
    groupId: index < 2 ? "first" : index < 4 ? "second" : "third",
  }));
  const input = projectInput.parse({
    version: 0,
    slug: "editorial",
    title: "Editorial",
    subtitle: "",
    description: "",
    category: "Landscape",
    year: "2026",
    coverPhotoId: photos[0].id,
    status: "published",
    sortOrder: 0,
    items,
  });
  const project = saveProject(null, input);
  assert.deepEqual(
    project.layouts.map((group) => [
      group.id,
      group.type,
      group.photoIds.length,
    ]),
    [
      ["first", "asymmetric", 2],
      ["second", "large-small", 2],
      ["third", "triptych", 3],
    ],
  );
  const next = saveProject(
    project.id,
    projectInput.parse({
      ...project,
      items: [...project.items.slice(4), ...project.items.slice(0, 4)],
    }),
  );
  assert.deepEqual(
    next.layouts.map((group) => group.id),
    ["third", "first", "second"],
  );
  assert.equal(
    next.items.find((item) => item.photoId === photos[0].id)!.caption,
    "caption-0",
  );
  assert.equal(listPhotos(false).length, photos.length);
  assert.equal(
    projectInput.safeParse({
      ...project,
      items: project.items.map((item) => ({
        ...item,
        groupId: "one-group",
        layoutType: "pair",
      })),
    }).success,
    false,
  );
  assert.equal(
    projectInput.safeParse({
      ...project,
      items: [project.items[0], project.items[2], project.items[1]],
    }).success,
    false,
  );
});
