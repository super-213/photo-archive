import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { PhotoSource } from "../src/lib/content";
import { hasLoadedPhoto, preloadAdjacentPhotos, preloadPhoto } from "../src/lib/photo-preload";

// Control completion and idle time without downloading images or requiring a browser.
const requests: FakeImage[] = [];
const idle = new Map<number, () => void>();
const connection = { saveData: false, effectiveType: "4g" };
class FakeImage {
  decoding = "";
  fetchPriority = "";
  sizes = "";
  srcset = "";
  currentSrc = "";
  onload?: () => void;
  onerror?: () => void;
  private source = "";
  set src(value: string) { this.source = value; requests.push(this); }
  get src() { return this.source; }
  complete(source = this.src) { this.currentSrc = source; this.onload?.(); }
}
const originals = new Map(["window", "navigator", "Image"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let idleId = 0;
Object.defineProperties(globalThis, {
  window: { configurable: true, value: {
    requestIdleCallback: (task: () => void) => { idle.set(++idleId, task); return idleId; },
    cancelIdleCallback: (id: number) => idle.delete(id),
  } },
  navigator: { configurable: true, value: { connection } },
  Image: { configurable: true, value: FakeImage },
});
after(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
function photo(id: string): PhotoSource {
  return { width: 1600, height: 1000, src: `/media/${id}/preview.webp`,
    previewSrc: `/media/${id}/preview.webp`, thumbnailSrc: `/media/${id}/thumbnail.webp`,
    lightboxSrc: `/media/${id}/lightbox.webp` };
}
function runIdle() {
  const tasks = [...idle.values()];
  idle.clear();
  tasks.forEach((task) => task());
}

test("responsive preloads deduplicate and remember the actual selected image for immediate redisplay", async () => {
  const first = preloadPhoto(photo("dedup"), "44vw");
  assert.equal(preloadPhoto(photo("dedup"), "44vw"), first);
  const request = requests.at(-1)!;
  assert.equal(request.fetchPriority, "low");
  assert.equal(request.sizes, "44vw");
  assert.match(request.srcset, /thumbnail\.webp 420w/);
  assert.doesNotMatch(request.srcset, /lightbox/);
  const selected = "https://example.test/media/dedup/thumbnail.webp";
  assert.equal(hasLoadedPhoto(selected), false);
  request.complete(selected);
  assert.equal(await first, true);
  assert.equal(hasLoadedPhoto(selected), true);
  assert.equal(hasLoadedPhoto(request.src), false);
});

test("failed speculation can retry, and data-saving connections make no speculative image requests", async () => {
  const target = photo("retry");
  const failed = preloadPhoto(target, "90vw");
  requests.at(-1)!.onerror?.();
  assert.equal(await failed, false);
  assert.equal(hasLoadedPhoto(target.src), false);
  const retry = preloadPhoto(target, "90vw");
  assert.notEqual(retry, failed);
  requests.at(-1)!.complete();
  assert.equal(await retry, true);
  const count = requests.length;
  try {
    connection.saveData = true;
    assert.equal(await preloadPhoto(photo("save-data"), "90vw"), false);
    connection.saveData = false;
    connection.effectiveType = "2g";
    assert.equal(await preloadPhoto(photo("slow"), "90vw"), false);
    assert.equal(requests.length, count);
  } finally { connection.saveData = false; connection.effectiveType = "4g"; }
});

test("neighbours wait for idle time, load sequentially, and stop queuing after the viewer changes", async () => {
  const photos = [photo("current"), photo("next"), photo("previous")];
  const count = requests.length;
  const cancel = preloadAdjacentPhotos(photos, 0, 1200, 800);
  assert.equal(requests.length, count);
  runIdle();
  assert.equal(requests.length, count + 1);
  assert.equal(requests.at(-1)!.src, photos[1].lightboxSrc);
  assert.equal(requests.at(-1)!.sizes, "1200px");
  assert.match(requests.at(-1)!.srcset, /lightbox\.webp 1600w/);
  requests.at(-1)!.complete();
  await Promise.resolve();
  assert.equal(requests.length, count + 2);
  assert.equal(requests.at(-1)!.src, photos[2].lightboxSrc);
  requests.at(-1)!.complete();
  await Promise.resolve();
  assert.equal(requests.length, count + 2);
  cancel();

  const stop = preloadAdjacentPhotos([photo("stop-current"), photo("stop-next"), photo("stop-prev")], 0, 1200, 800);
  runIdle();
  stop();
  const stoppedAt = requests.length;
  requests.at(-1)!.complete();
  await Promise.resolve();
  assert.equal(requests.length, stoppedAt);
});

test("two-photo series preload their single neighbour once and closing before idle cancels the work", async () => {
  const count = requests.length;
  const cancel = preloadAdjacentPhotos([photo("cancel-current"), photo("cancel-next")], 0, 1200, 800);
  cancel();
  runIdle();
  assert.equal(requests.length, count);
  const stop = preloadAdjacentPhotos([photo("two-current"), photo("two-next")], 0, 1200, 800);
  runIdle();
  requests.at(-1)!.complete();
  await Promise.resolve();
  assert.equal(requests.length, count + 1);
  stop();
});
