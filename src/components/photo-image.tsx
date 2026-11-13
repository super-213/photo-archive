"use client";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ImgHTMLAttributes } from "react";
import type { Photo } from "@/lib/content";
import { photoSources } from "@/lib/photo-sources";
import { hasLoadedPhoto, rememberLoadedPhoto } from "@/lib/photo-preload";

type PhotoImageProps = {
  photo: Photo;
  sizes: string;
  fill?: boolean;
  variant?: "preview" | "lightbox";
  onReady?: () => void;
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
  onReady,
  ...props
}: PhotoImageProps) {
  const element = useRef<HTMLImageElement>(null);
  const [{ status, reveal }, setState] = useState({ status: "loading", reveal: false });
  const sources = photoSources(photo, variant);
  useLayoutEffect(() => {
    const image = element.current;
    if (image?.complete && image.naturalWidth) {
      // Cached or already displayed during hydration: show it before the next paint.
      rememberLoadedPhoto(image.currentSrc || image.src);
      setState({ status: "loaded", reveal: false });
      onReady?.();
    } else {
      const status = image?.complete ? "error" : "loading";
      setState((current) => current.status === status && !current.reveal
        ? current : { status, reveal: false });
    }
  }, [sources.src, sources.srcSet, onReady]);
  return (
    <>
      <img
        ref={element}
        data-image-status={status}
        data-image-reveal={reveal ? "true" : undefined}
        onLoad={(event) => {
          const image = event.currentTarget;
          const source = image.currentSrc || image.src;
          const cached = hasLoadedPhoto(source);
          rememberLoadedPhoto(source);
          setState((current) => ({ status: "loaded", reveal: !cached && current.status === "loading" }));
          onReady?.();
        }}
        onError={() => setState({ status: "error", reveal: false })}
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
