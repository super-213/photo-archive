import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import sharp from "sharp";
import manifest from "../src/app/manifest";
import nextConfig from "../next.config";

const origin = "https://photos.example.test";
const workerSource = await readFile("public/sw.js", "utf8");
const offlineHtml = await readFile("public/offline.html", "utf8");

function workerHarness() {
  type WorkerEvent = {
    request?: Request; data?: unknown;
    waitUntil(task: Promise<unknown>): void;
    respondWith?(response: Promise<Response>): void;
  };
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const networkRequests: string[] = [];
  let offline = false;
  let status = 200;
  let brokenStorage = false;
  let activations = 0;
  let claims = 0;
  const key = (input: Request | string) => new URL(typeof input === "string" ? input : input.url, origin).href;
  const fetch = async (input: Request | string) => {
    const url = key(input);
    networkRequests.push(url);
    if (offline) throw new TypeError("Network unavailable");
    const response = new Response(url.endsWith("/offline.html") ? offlineHtml : `network:${url}`, { status });
    Object.defineProperty(response, "type", { value: "basic" });
    return response;
  };
  const caches = {
    async keys() { return [...stores.keys()]; },
    async delete(name: string) { return stores.delete(name); },
    async open(name: string) {
      if (brokenStorage) throw new Error("Storage quota exceeded");
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        async match(input: Request | string) { return store.get(key(input))?.clone(); },
        async put(input: Request | string, response: Response) { store.set(key(input), response.clone()); },
        async addAll(requests: Request[]) {
          const responses = await Promise.all(requests.map(fetch));
          if (responses.some((response) => !response.ok)) throw new Error("Precache failed");
          requests.forEach((request, index) => store.set(key(request), responses[index].clone()));
        },
      };
    },
  };
  class BrowserRequest extends Request {
    constructor(input: string, init?: RequestInit) { super(new URL(input, origin), init); }
  }
  const context = vm.createContext({
    Request: BrowserRequest, Response, URL, fetch, caches,
    self: {
      location: { origin },
      addEventListener(name: string, listener: (event: WorkerEvent) => void) { listeners.set(name, listener); },
      async skipWaiting() { activations++; },
      clients: { async claim() { claims++; } },
    },
  });
  vm.runInContext(workerSource, context);
  async function dispatch(type: string, fields: Partial<WorkerEvent> = {}) {
    const waits: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    listeners.get(type)!({ ...fields,
      waitUntil: (task) => { waits.push(task); },
      respondWith: (task) => { response = Promise.resolve(task); },
    });
    const result = response ? await response : undefined;
    await Promise.all(waits);
    return result;
  }
  function request(pathname: string, mode: RequestMode = "navigate", method = "GET") {
    // Native Request constructors cannot create navigation requests; the browser does.
    return { url: new URL(pathname, origin).href, mode, method } as Request;
  }
  return { stores, networkRequests, dispatch, request,
    offline: () => { offline = true; }, status: (value: number) => { status = value; },
    breakStorage: () => { brokenStorage = true; },
    activations: () => activations, claims: () => claims,
  };
}

test("manifest uses a stable install identity, standalone mode and valid opaque icons", async () => {
  const app = manifest();
  assert.equal(app.id, "/");
  assert.equal(app.start_url, "/");
  assert.equal(app.scope, "/");
  assert.equal(app.display, "standalone");
  assert.equal(app.short_name, "片隅");
  for (const icon of app.icons!) {
    const image = await sharp(await readFile(`public${icon.src}`)).metadata();
    assert.equal(`${image.width}x${image.height}`, icon.sizes);
    assert.equal(image.hasAlpha, false);
  }
  const { data, info } = await sharp("public/pwa/icon-maskable-512.png").raw().toBuffer({ resolveWithObject: true });
  let farthest = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * info.channels] < 80) farthest = Math.max(farthest, Math.hypot(x - 255.5, y - 255.5));
  }
  assert.ok(farthest > 150 && farthest < 512 * .4, "the entire visible logo must fit inside the maskable safe circle");
  const headers = await nextConfig.headers!();
  const worker = headers.find((entry) => entry.source === "/sw.js")!;
  assert.ok(worker.headers.some((header) => header.key === "Cache-Control" && header.value.includes("no-store")));
  assert.ok(worker.headers.some((header) => header.key === "Service-Worker-Allowed" && header.value === "/"));
});

test("worker precaches only the offline shell and brand assets; updates require an explicit action", async () => {
  const worker = workerHarness();
  await worker.dispatch("install");
  assert.equal(worker.activations(), 0);
  const cached = [...worker.stores.values()][0];
  assert.ok([...cached.keys()].some((url) => url.endsWith("/offline.html")));
  assert.ok([...cached.keys()].every((url) => /\/(offline\.html|logo(?:-light)?\.svg|pwa\/icon-[\w-]+\.png)$/.test(url)));
  worker.stores.set("pianyu-pwa-obsolete", new Map());
  worker.stores.set("another-app-cache", new Map());
  await worker.dispatch("activate");
  assert.equal(worker.claims(), 1);
  assert.equal(worker.stores.has("pianyu-pwa-obsolete"), false);
  assert.equal(worker.stores.has("another-app-cache"), true);
  await worker.dispatch("message", { data: { type: "UNRELATED" } });
  assert.equal(worker.activations(), 0);
  await worker.dispatch("message", { data: { type: "SKIP_WAITING" } });
  assert.equal(worker.activations(), 1);
});

test("public navigations remain network-first and show an uncached offline fallback on network failure", async () => {
  const worker = workerHarness();
  await worker.dispatch("install");
  const before = [...worker.stores.values()][0].size;
  const online = await worker.dispatch("fetch", { request: worker.request("/works/sea?category=Travel") });
  assert.equal(online?.status, 200);
  assert.match(await online!.text(), /^network:/);
  assert.equal([...worker.stores.values()][0].size, before);
  worker.offline();
  for (const pathname of ["/", "/archive", "/archive?category=Travel", "/works/sea"]) {
    const response = await worker.dispatch("fetch", { request: worker.request(pathname) });
    assert.equal(response?.status, 503);
    assert.match(response!.headers.get("content-type")!, /text\/html/);
    assert.equal(response!.headers.get("cache-control"), "no-store");
    assert.equal(response!.headers.get("x-robots-tag"), "noindex");
    assert.match(await response!.text(), /等网络回来/);
  }
  assert.equal([...worker.stores.values()][0].size, before);
});

test("private data, APIs, downloads, RSC, foreign origins and writes bypass the worker completely", async () => {
  const worker = workerHarness();
  await worker.dispatch("install");
  worker.offline();
  const requests = [
    ...["/admin", "/admin/photos", "/admin/projects/test", "/api/photos", "/api/auth/sign-in/email", "/api/telemetry", "/media/photo/preview.webp", "/media/photo/original", "/media/photo/download", "/share", "/share/sea", "/_next/static/chunk.js"].map((path) => worker.request(path)),
    worker.request("/archive?_rsc=test", "cors"), worker.request("/works/sea?_rsc=test", "cors"),
    worker.request("/logo.svg?token=private", "cors"),
    worker.request("https://other.example.test/", "navigate"), worker.request("/", "navigate", "POST"),
  ];
  const before = worker.networkRequests.length;
  for (const request of requests) assert.equal(await worker.dispatch("fetch", { request }), undefined, request.url);
  assert.equal(worker.networkRequests.length, before);
});

test("HTTP errors keep their original status and storage failures do not break live browsing", async () => {
  for (const status of [401, 404, 500]) {
    const worker = workerHarness();
    await worker.dispatch("install");
    worker.status(status);
    const response = await worker.dispatch("fetch", { request: worker.request("/works/missing") });
    assert.equal(response?.status, status);
    assert.doesNotMatch(await response!.text(), /等网络回来/);
  }
  const worker = workerHarness();
  await worker.dispatch("install");
  worker.breakStorage();
  assert.equal((await worker.dispatch("fetch", { request: worker.request("/") }))?.status, 200);
  assert.equal((await worker.dispatch("fetch", { request: worker.request("/logo.svg", "cors") }))?.status, 200);
  worker.offline();
  const response = await worker.dispatch("fetch", { request: worker.request("/") });
  assert.equal(response?.status, 503);
  assert.match(response!.headers.get("content-type")!, /text\/plain/);
});

test("brand assets refresh online and can be read offline without caching photo resources", async () => {
  const worker = workerHarness();
  await worker.dispatch("install");
  const request = worker.request("/logo.svg", "cors");
  const online = await worker.dispatch("fetch", { request });
  assert.equal(online?.status, 200);
  worker.offline();
  const cached = await worker.dispatch("fetch", { request });
  assert.equal(cached?.status, 200);
  assert.match(await cached!.text(), /logo\.svg/);
  assert.equal(await worker.dispatch("fetch", { request: worker.request("/media/private/preview.webp", "cors") }), undefined);
});
