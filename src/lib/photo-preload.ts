import type { PhotoSource } from "./content";
import { lightboxImageSizes, photoSources } from "./photo-sources";

const loadedSources = new Set<string>();
const preloads = new Map<string, Promise<boolean>>();

export function hasLoadedPhoto(source: string) {
  return loadedSources.has(source);
}

export function rememberLoadedPhoto(source: string) {
  if (!source) return;
  loadedSources.delete(source);
  loadedSources.add(source);
  if (loadedSources.size > 256) loadedSources.delete(loadedSources.values().next().value!);
}

export function canPreloadPhotos() {
  if (typeof window === "undefined") return false;
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  return !connection?.saveData && !["slow-2g", "2g"].includes(connection?.effectiveType || "");
}

export function preloadPhoto(photo: PhotoSource, sizes: string, variant: "preview" | "lightbox" = "preview") {
  if (!canPreloadPhotos()) return Promise.resolve(false);
  const sources = photoSources(photo, variant);
  const key = JSON.stringify([sources.src, sources.srcSet, sizes]);
  const existing = preloads.get(key);
  if (existing) return existing;
  const pending = new Promise<boolean>((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.fetchPriority = "low";
    image.onload = () => {
      rememberLoadedPhoto(image.currentSrc || image.src);
      resolve(true);
    };
    image.onerror = () => {
      preloads.delete(key);
      resolve(false);
    };
    // Set the same responsive candidates as the rendered image, before starting the request.
    image.sizes = sizes;
    if (sources.srcSet) image.srcset = sources.srcSet;
    image.src = sources.src;
  });
  preloads.set(key, pending);
  if (preloads.size > 32) preloads.delete(preloads.keys().next().value!);
  return pending;
}

function schedulePhotoPreload(task: () => void) {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(task, { timeout: 1000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(task, 150);
  return () => window.clearTimeout(id);
}

export function preloadAdjacentPhotos(photos: PhotoSource[], index: number, width: number, height: number) {
  if (photos.length < 2 || !canPreloadPhotos()) return () => {};
  let cancelled = false;
  const cancelIdle = schedulePhotoPreload(() => {
    // Start only after the visible image is ready, and never preload the whole series.
    const neighbours = [...new Set([(index + 1) % photos.length, (index - 1 + photos.length) % photos.length])];
    void (async () => {
      for (const neighbour of neighbours) {
        if (cancelled) break;
        const photo = photos[neighbour];
        await preloadPhoto(photo, lightboxImageSizes(photo, width, height), "lightbox");
      }
    })();
  });
  return () => { cancelled = true; cancelIdle(); };
}
