import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const directory = await mkdtemp(path.join(tmpdir(), "photo-auth-origins-"));
process.env.PHOTO_ARCHIVE_DATA_DIR = directory;
process.env.BETTER_AUTH_URL = "https://photos.example.test";
delete process.env.PHOTO_ARCHIVE_COPYRIGHT_AUTHOR;
delete process.env.PHOTO_ARCHIVE_COPYRIGHT_NOTICE;
const { getAuth, createAuth, getAdministrator } = await import("../src/lib/server/auth");
const { getDatabase } = await import("../src/lib/server/database");
const { getRequestOrigin } = await import("../src/lib/server/origins");
const { importPhoto } = await import("../src/lib/server/media");
const { getPhoto } = await import("../src/lib/server/store");
const authRoute = await import("../src/app/api/auth/[...all]/route");
const photoRoute = await import("../src/app/api/admin/photos/[id]/route");
const mediaRoute = await import("../src/app/media/[id]/[variant]/route");

after(async () => {
  getDatabase().close();
  await rm(directory, { recursive: true, force: true });
});

test("domain, loopback and this machine's LAN address support login, private media, editing and logout", async () => {
  await getAuth();
  const email = "owner@example.test";
  const password = "a-test-only-long-password";
  const signup = await createAuth(true).api.signUpEmail({ body: { name: "Owner", email, password } });
  getDatabase().prepare("INSERT INTO administrator(user_id) VALUES (?)").run(signup.user.id);
  const image = await sharp({ create: { width: 32, height: 24, channels: 3, background: "red" } }).jpeg().toBuffer();
  const id = (await importPhoto(image, "private.jpg")).photo.id;
  const origins = [process.env.BETTER_AUTH_URL!, "http://127.0.0.1:9005", "http://localhost:9005"];
  const lan = Object.values(networkInterfaces()).flat().find((entry) => entry?.family === "IPv4" &&
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address));
  if (lan) origins.push(`http://${lan.address}:9005`);
  for (const origin of origins) {
    const host = new URL(origin).host;
    const login = await authRoute.POST(new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST", headers: { host, origin, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }));
    assert.equal(login.status, 200, origin);
    const token = login.headers.getSetCookie().find((entry) => entry.includes("session_token="))!;
    assert.ok(token, origin);
    assert.equal(/; Secure(?:;|$)/i.test(token), origin.startsWith("https:"), origin);
    assert.match(token, /HttpOnly/i);
    assert.doesNotMatch(token, /; Domain=/i);
    const cookie = login.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
    const headers = { host, origin, cookie, "Content-Type": "application/json" };
    assert.equal((await getAdministrator(new Headers(headers)))?.id, signup.user.id);
    const response = await photoRoute.PUT(new Request(`${origin}/api/admin/photos/${id}`, {
      method: "PUT", headers, body: JSON.stringify({ ...getPhoto(id), title: `Saved via ${host}` }),
    }), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 200, origin);
    for (const stage of ["auth", "body", "db", "total"])
      assert.match(response.headers.get("server-timing")!, new RegExp(`${stage};dur=\\d+\\.\\d+`));
    assert.match(response.headers.get("x-request-id")!, /^[\da-f-]{36}$/);
    assert.equal((await response.json()).photo.title, `Saved via ${host}`);
    const media = await mediaRoute.GET(new Request(`${origin}/media/${id}/thumbnail`, { headers }), {
      params: Promise.resolve({ id, variant: "thumbnail" }),
    });
    assert.equal(media.status, 200, origin);
    await media.arrayBuffer();
    for (const badOrigin of ["https://evil.example", origins.find((value) => value !== origin)!, "null"]) {
      const rejected = await photoRoute.PUT(new Request(`${origin}/api/admin/photos/${id}`, {
        method: "PUT", headers: { ...headers, origin: badOrigin }, body: JSON.stringify(getPhoto(id)),
      }), { params: Promise.resolve({ id }) });
      assert.equal(rejected.status, 403, `${origin} from ${badOrigin}`);
    }
    const logout = await authRoute.POST(new Request(`${origin}/api/auth/sign-out`, { method: "POST", headers }));
    assert.equal(logout.status, 200, origin);
    assert.equal(await getAdministrator(new Headers(headers)), null);
  }
});

test("unknown hosts and forged proxy headers cannot expand allowed origins", async () => {
  for (const host of ["evil.example", "192.168.254.254:9005", "127.0.0.1.evil.example:9005", "user@localhost:9005", "localhost:9005/path"]) {
    assert.throws(() => getRequestOrigin(new Headers({ host })), /未启用后台登录/);
  }
  const headers = new Headers({ host: "127.0.0.1:9005", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" });
  assert.equal(getRequestOrigin(headers), "http://127.0.0.1:9005");
  for (const origin of ["https://evil.example", "https://photos.example.test", "null", ""]) {
    const response = await authRoute.POST(new Request("http://127.0.0.1:9005/api/auth/sign-out", {
      method: "POST", headers: { host: "127.0.0.1:9005", ...(origin ? { origin } : {}) },
    }));
    assert.equal(response.status, 403);
  }
});
