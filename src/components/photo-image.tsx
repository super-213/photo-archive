"use client";
import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import type { Photo } from "@/lib/content";

type PhotoImageProps = {
  photo: Photo;
  sizes: string;
  fill?: boolean;
  variant?: "grid" | "lightbox";
} & Pick<
  ImgHTMLAttributes<HTMLImageElement>,
  "loading" | "fetchPriority" | "className"
>;

export function PhotoImage({
  photo,
  sizes,
  fill = false,
  variant = "grid",
  loading = "lazy",
  ...props
}: PhotoImageProps) {
  const element = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState("loading");
  useEffect(() => {
    const image = element.current;
    if (image?.complete) setStatus(image.naturalWidth ? "loaded" : "error");
  }, [photo.id, photo.src]);
  const sources = new Map<number, string>();
  for (const [size, source] of [
    [420, photo.thumbnailSrc],
    [1440, photo.src],
    [2560, photo.lightboxSrc],
  ] as const) {
    const width = Math.round(
      photo.width * Math.min(1, size / Math.max(photo.width, photo.height)),
    );
    sources.set(width, source);
  }
  return (
    <>
      <img
        ref={element}
        data-image-status={status}
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
        src={variant === "lightbox" ? photo.lightboxSrc : photo.src}
        srcSet={[...sources]
          .map(([width, source]) => `${source} ${width}w`)
          .join(", ")}
        sizes={sizes}
        width={photo.width}
        height={photo.height}
        alt={photo.alt}
        loading={loading}
        decoding="async"
        style={
          fill
            ? { position: "absolute", inset: 0, width: "100%", height: "100%" }
            : undefined
        }
        {...props}
      />
      {status === "error" && (
        <span className="photo-load-error">图片暂时无法载入</span>
      )}
    </>
  );
}
