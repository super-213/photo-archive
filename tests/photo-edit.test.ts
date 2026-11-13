import assert from "node:assert/strict";
import { test } from "node:test";
import type { Photo } from "../src/lib/content";
import { getPhotoChanges } from "../src/lib/photo-edit";

const photo: Photo = {
  id: "photo", version: 3, title: "原有标题", alt: "照片描述", description: "简介", source: "",
  category: "Landscape", visibility: "public", year: "2026", capturedAt: "2026-11-12", location: "山间",
  cameraMake: "品牌", cameraModel: "机身", lensModel: "镜头", focalLength: "35mm", aperture: "f/4",
  shutterSpeed: "1/125", iso: "100", tags: ["旅行", "风光"], isSample: false,
  src: "/preview.webp", thumbnailSrc: "/thumbnail.webp", lightboxSrc: "/lightbox.webp", width: 6000, height: 4000,
};

function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries(photo)) {
    if (typeof value === "string") data.set(key, value);
  }
  data.set("tags", photo.tags.join(", "));
  return data;
}

test("editing a title sends only that field and the conflict version", () => {
  const data = form();
  data.set("title", "  新标题  ");
  assert.deepEqual(getPhotoChanges(photo, data), { version: 3, title: "新标题" });
});

test("unchanged forms, whitespace, duplicate tags and tag reordering require no request", () => {
  const data = form();
  data.set("title", "  原有标题  ");
  data.set("tags", "风光，旅行, 旅行");
  assert.deepEqual(getPhotoChanges(photo, data), { version: 3 });
});

test("explicitly clearing text and tags is preserved in the incremental payload", () => {
  const data = new FormData();
  data.set("title", "  ");
  data.set("tags", "");
  data.set("location", "");
  assert.deepEqual(getPhotoChanges(photo, data), { version: 3, title: "", location: "", tags: [] });
});
