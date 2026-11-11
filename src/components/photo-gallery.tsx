"use client";

import Image from "next/image";
import { useState } from "react";
import type { Photo, PhotoLayout } from "@/lib/content";
import { PhotoViewer } from "./photo-viewer";

export function PhotoGallery({
  photos,
  layouts,
}: {
  photos: Photo[];
  layouts?: PhotoLayout[];
}) {
  const [selected, setSelected] = useState<number | null>(null);
  function photoButton(photo: Photo) {
    return (
      <button
        className="photo-button"
        key={photo.id}
        onClick={() =>
          setSelected(photos.findIndex((item) => item.id === photo.id))
        }
        aria-label={`查看大图，${photo.title}`}
      >
        <Image
          src={photo.src}
          alt={photo.alt}
          width={photo.width}
          height={photo.height}
          loading={photo.id === photos[0]?.id ? "eager" : "lazy"}
          sizes={
            layouts
              ? "(max-width: 767px) 90vw, 80vw"
              : "(max-width: 767px) 45vw, (max-width: 1199px) 30vw, 25vw"
          }
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
            <div className={`photo-layout layout-${layout.type}`} key={index}>
              {layout.photoIds
                .map((id) => photos.find((photo) => photo.id === id))
                .filter((photo): photo is Photo => Boolean(photo))
                .map(photoButton)}
            </div>
          ))}
        </div>
      ) : (
        <div className="archive-grid">{photos.map(photoButton)}</div>
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
