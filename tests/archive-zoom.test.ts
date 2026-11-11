import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterArchivePhotos,
  readArchiveFilters,
} from "../src/lib/archive-filters";
import { buildPhotoLayouts, type Photo } from "../src/lib/content";
import {
  constrainTransform,
  initialTransform,
  zoomAt,
} from "../src/lib/photo-zoom";

const base: Photo = {
  id: "one",
  src: "/media/one/grid",
  lightboxSrc: "/media/one/lightbox",
  thumbnailSrc: "/media/one/thumbnail",
  title: "雨夜街头",
  alt: "雨中的行人",
  description: "Blue hour",
  width: 1600,
  height: 1000,
  category: "Street",
  year: "2025",
  location: "东京",
  source: "",
  visibility: "public",
  capturedAt: "2025-10-01",
  cameraMake: "SONY",
  cameraModel: "Sony A7 IV",
  lensModel: "FE 50mm F1.8",
  focalLength: "50 mm",
  aperture: "f/2.8",
  shutterSpeed: "1/125 s",
  iso: "400",
  tags: ["夜景", "旅行"],
  isSample: false,
  version: 1,
};
const photos = [
  base,
  {
    ...base,
    id: "two",
    location: "京都",
    year: "2024",
    category: "Landscape" as const,
  },
  { ...base, id: "private", visibility: "private" as const, title: "保密" },
];

test("archive filters public photos by category", () => {
  assert.deepEqual(
    filterArchivePhotos(photos, readArchiveFilters(new URLSearchParams())).map(
      (photo) => photo.id,
    ),
    ["one", "two"],
  );
  assert.deepEqual(
    filterArchivePhotos(
      photos,
      readArchiveFilters(new URLSearchParams({ category: "Street" })),
    ).map((photo) => photo.id),
    ["one"],
  );
  assert.deepEqual(filterArchivePhotos(photos, { category: "Travel" }), []);
});

test("retired URL filters cannot hide photos or constrain category selection", () => {
  const params = new URLSearchParams({
    year: "1900",
    location: "missing",
    camera: "missing",
    lens: "missing",
    q: "missing",
  });
  assert.deepEqual(readArchiveFilters(params), { category: "all" });
  assert.equal(filterArchivePhotos(photos, readArchiveFilters(params)).length, 2);
  params.set("category", "Street");
  assert.deepEqual(
    filterArchivePhotos(photos, readArchiveFilters(params)).map((photo) => photo.id),
    ["one"],
  );
  assert.deepEqual(
    readArchiveFilters(new URLSearchParams(params.toString())),
    { category: "Street" },
  );
});

test("unknown category URLs fall back to all public photos", () => {
  const filters = readArchiveFilters(
    new URLSearchParams({ category: "Unknown" }),
  );
  assert.deepEqual(filters, { category: "all" });
  assert.equal(filterArchivePhotos(photos, filters).length, 2);
});

test("legacy layouts keep their order while explicit neighboring groups stay separate", () => {
  const items = ["a", "b", "c", "d"].map((photoId) => ({
    photoId,
    layoutType: "pair" as const,
    caption: "",
  }));
  assert.deepEqual(
    buildPhotoLayouts(items).map((group) => group.photoIds),
    [
      ["a", "b"],
      ["c", "d"],
    ],
  );
  const explicit = items.map((item, index) => ({
    ...item,
    groupId: `group-${index}`,
  }));
  assert.equal(buildPhotoLayouts(explicit).length, 4);
  assert.deepEqual(
    buildPhotoLayouts(
      items.map((item) => ({ ...item, layoutType: "triptych" })),
    ).map((group) => group.photoIds),
    [["a", "b", "c"], ["d"]],
  );
});
test("zoom preserves the image point under the anchor until bounded by the edges", () => {
  const dimensions = { width: 1000, height: 1000 };
  const anchor = { x: 100, y: -80 };
  const view = zoomAt(initialTransform, 2, anchor, dimensions, dimensions);
  assert.deepEqual(view, { scale: 2, x: -100, y: 80 });
  assert.equal((anchor.x - view.x) / view.scale, anchor.x);
  assert.equal((anchor.y - view.y) / view.scale, anchor.y);
  assert.deepEqual(
    zoomAt(view, 1, anchor, dimensions, dimensions),
    initialTransform,
  );
});
test("pan bounds respect fitted landscape and portrait sizes, resize and zoom limits", () => {
  const viewport = { width: 1000, height: 800 };
  assert.deepEqual(
    constrainTransform(
      { scale: 2, x: 9000, y: -9000 },
      { width: 2000, height: 1000 },
      viewport,
    ),
    { scale: 2, x: 500, y: -100 },
  );
  assert.deepEqual(
    constrainTransform(
      { scale: 2, x: 9000, y: -9000 },
      { width: 500, height: 1000 },
      viewport,
    ),
    { scale: 2, x: 0, y: -400 },
  );
  assert.equal(
    zoomAt(initialTransform, 100, { x: 0, y: 0 }, base, viewport).scale,
    4,
  );
  const reset = constrainTransform(
    { scale: 0.5, x: 100, y: -100 },
    base,
    viewport,
  );
  assert.deepEqual(reset, initialTransform);
  const resized = constrainTransform({ scale: 2, x: 1000, y: 1000 }, base, {
    width: 320,
    height: 500,
  });
  assert.ok(resized.x <= 160 && resized.y === 0);
});
