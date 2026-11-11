import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const directory = await mkdtemp(path.join(os.tmpdir(), "photo-archive-test-"));
process.env.PHOTO_ARCHIVE_DATA_DIR = directory;
delete process.env.BETTER_AUTH_URL;
const { importPhoto, getMediaRecord, readMedia, maxUploadBytes } =
  await import("../src/lib/server/media");
const {
  listPhotos,
  getPhoto,
  updatePhoto,
  listProjects,
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
  for (const variant of ["thumbnail", "grid", "lightbox"]) {
    const bytes = await readMedia(getMediaRecord(photoId, variant)!);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.orientation, undefined);
  }
  assert.deepEqual(
    await readMedia(getMediaRecord(photoId, "original")!),
    buffer,
  );
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
  assert.match(response.headers.get("Cache-Control")!, /no-store/);
  assert.equal(
    (
      await mediaRoute.GET(new Request(`${origin}/media/${photoId}/original`), {
        params: Promise.resolve({ id: photoId, variant: "original" }),
      })
    ).status,
    404,
  );
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
  assert.ok(getMediaRecord(otherPhoto.id, "original"));
});

test("withdrawing a photo atomically unpublishes affected projects and blocks stale edits", async () => {
  const before = getPhoto(photoId)!;
  const { unpublished } = updatePhoto(
    photoId,
    photoInput.parse({ ...before, visibility: "private" }),
  );
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
    new Request(`${origin}/media/${photoId}/original`, {
      headers: { cookie, host: "localhost:3456" },
    }),
    { params: Promise.resolve({ id: photoId, variant: "original" }) },
  );
  assert.equal(privateMedia.status, 200);
});

test("invalid images and oversized payloads fail cleanly and allow subsequent uploads", async () => {
  const count = listPhotos(false).length;
  await assert.rejects(
    importPhoto(Buffer.from("not a photo"), "fake.jpg"),
    /无法读取/,
  );
  await assert.rejects(
    importPhoto(Buffer.alloc(maxUploadBytes + 1), "large.jpg"),
    /32 MB/,
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

test("AVIF originals retain their correct media type and SVG is rejected", async () => {
  const avif = await sharp({
    create: { width: 64, height: 40, channels: 3, background: "blue" },
  })
    .avif()
    .toBuffer();
  const result = await importPhoto(avif, "fixture.avif");
  assert.equal(
    getMediaRecord(result.photo.id, "original")!.mime_type,
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
