"use client";

import { PhotoImage } from "@/components/photo-image";
import { useState } from "react";
import type { Photo, PhotoLayout } from "@/lib/content";
import dynamic from "next/dynamic";
import { layoutImageSizes } from "@/lib/photo-sources";
import { canPreloadPhotos } from "@/lib/photo-preload";

const PhotoViewer = dynamic(() =>
  import("./photo-viewer").then((module) => module.PhotoViewer),
);

function prepareViewer() {
  if (canPreloadPhotos()) void import("./photo-viewer").catch(() => {});
}

export function PhotoGallery({
  photos,
  layouts,
  batchSize = Math.max(1, photos.length),
}: {
  photos: Photo[];
  layouts?: PhotoLayout[];
  batchSize?: number;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const photoById = new Map(photos.map((photo, index) => [photo.id, { photo, index }]));
  const batches: Photo[][] = [];
  for (let index = 0; index < photos.length; index += batchSize) {
    batches.push(photos.slice(index, index + batchSize));
  }
  function photoButton(photo: Photo, sizes: string) {
    return (
      <button
        type="button"
        className="photo-button"
        key={photo.id}
        onPointerEnter={(event) => { if (event.pointerType !== "touch") prepareViewer(); }}
        onFocus={prepareViewer}
        onPointerDown={prepareViewer}
        onClick={() =>
          setSelected(photoById.get(photo.id)!.index)
        }
        aria-label={photo.title ? `查看大图，${photo.title}` : "查看大图"}
      >
        <PhotoImage
          photo={photo}
          loading={photo.id === photos[0]?.id ? "eager" : "lazy"}
          fetchPriority={photo.id === photos[0]?.id ? "high" : "auto"}
          sizes={sizes}
        />
        <span className="photo-hover" aria-hidden="true">
          查看大图 ↗
        </span>
      </button>
    );
  }
  return (
    <>
      {layouts ? (
        <div className="project-gallery">
          {layouts.map((layout, index) => (
            <div
              className={`photo-layout layout-${layout.type}${layout.photoIds.length === 1 ? " layout-single" : ""}`}
              data-photo-count={layout.photoIds.length}
              key={layout.id || index}
            >
              {layout.photoIds
                .map((id) => photoById.get(id)?.photo)
                .filter((photo): photo is Photo => Boolean(photo))
                .map((photo, index) =>
                  photoButton(photo, layoutImageSizes(layout, index)),
                )}
            </div>
          ))}
        </div>
      ) : (
        batches.map((batch) => (
          <div className="archive-grid" key={batch[0].id}>
            {batch.map((photo) => photoButton(
              photo,
              "(max-width: 767px) calc((100vw - 62px) / 2), (max-width: 1199px) 30vw, (min-width: 1778px) 350px, 22vw",
            ))}
          </div>
        ))
      )}
      {selected !== null && (
        <PhotoViewer
          photos={photos}
          initialIndex={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
