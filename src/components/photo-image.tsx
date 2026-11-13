"use client";
import { useEffect, useRef, useState, type CSSProperties, type ImgHTMLAttributes } from "react";
import type { Photo } from "@/lib/content";
import { photoSources } from "@/lib/photo-sources";

type PhotoImageProps = {
  photo: Photo;
  sizes: string;
  fill?: boolean;
  variant?: "preview" | "lightbox";
} & Pick<
  ImgHTMLAttributes<HTMLImageElement>,
  "loading" | "fetchPriority" | "className"
>;

export function PhotoImage({
  photo,
  sizes,
  fill = false,
  variant = "preview",
  loading = "lazy",
  ...props
}: PhotoImageProps) {
  const element = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState("loading");
  useEffect(() => {
    const image = element.current;
    if (image?.complete) setStatus(image.naturalWidth ? "loaded" : "error");
  }, [photo.id, photo.src]);
  const sources = photoSources(photo, variant);
  return (
    <>
      <img
        ref={element}
        data-image-status={status}
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
        src={sources.src}
        srcSet={sources.srcSet}
        sizes={sizes}
        width={photo.width}
        height={photo.height}
        alt={photo.alt}
        loading={loading}
        decoding="async"
        style={{
          "--photo-aspect-ratio": `${photo.width} / ${photo.height}`,
          ...(fill ? { position: "absolute", inset: 0, width: "100%", height: "100%" } : {}),
        } as CSSProperties}
        {...props}
      />
      {status === "error" && (
        <span className="photo-load-error">图片暂时无法载入</span>
      )}
    </>
  );
}
