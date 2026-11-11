"use client";

import { PhotoImage } from "@/components/photo-image";
import { useState } from "react";
import type { Photo, PhotoLayout } from "@/lib/content";
import { PhotoViewer } from "./photo-viewer";

function layoutImageSizes(layout: PhotoLayout, index: number) {
  const widths = {
    full: 90,
    center: 58,
    pair: 44,
    asymmetric: 44,
    "large-small": index === 0 ? 55 : 33,
    triptych: layout.photoIds.length === 2 ? 44 : 29,
  };
  const desktopWidth =
    layout.photoIds.length === 1 && layout.type !== "full"
      ? 58
      : widths[layout.type];
  return `(max-width: 767px) 90vw, ${desktopWidth}vw`;
}

export function PhotoGallery({
  photos,
  layouts,
}: {
  photos: Photo[];
  layouts?: PhotoLayout[];
}) {
  const [selected, setSelected] = useState<number | null>(null);
  function photoButton(photo: Photo, sizes: string) {
    return (
      <button
        type="button"
        className="photo-button"
        key={photo.id}
        onClick={() =>
          setSelected(photos.findIndex((item) => item.id === photo.id))
        }
        aria-label={`查看大图，${photo.title}`}
      >
        <PhotoImage
          photo={photo}
          loading={photo.id === photos[0]?.id ? "eager" : "lazy"}
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
                .map((id) => photos.find((photo) => photo.id === id))
                .filter((photo): photo is Photo => Boolean(photo))
                .map((photo, index) =>
                  photoButton(photo, layoutImageSizes(layout, index)),
                )}
            </div>
          ))}
        </div>
      ) : (
        <div className="archive-grid">
          {photos.map((photo) =>
            photoButton(
              photo,
              "(max-width: 767px) 45vw, (max-width: 1199px) 30vw, 25vw",
            ),
          )}
        </div>
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
