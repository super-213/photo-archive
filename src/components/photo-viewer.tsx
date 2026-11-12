"use client";

import { ZoomablePhoto, type ZoomControls } from "./zoomable-photo";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Photo } from "@/lib/content";
import { Arrow, Close } from "./icons";

export function PhotoViewer({
  photos,
  initialIndex,
  onClose,
}: {
  photos: Photo[];
  initialIndex: number;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeAnimation = useRef<Animation | null>(null);
  const zoom = useRef<ZoomControls | null>(null);
  const [index, setIndex] = useState(initialIndex);
  const [showInfo, setShowInfo] = useState(false);
  const photo = photos[index];
  const move = useCallback(
    (step: number) =>
      setIndex((current) => (current + step + photos.length) % photos.length),
    [photos.length],
  );

  function requestClose() {
    const element = dialog.current;
    if (closeAnimation.current) return;
    if (
      !element ||
      typeof element.animate !== "function" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      onClose();
      return;
    }
    closeAnimation.current = element.animate(
      [{ opacity: getComputedStyle(element).opacity }, { opacity: 0 }],
      { duration: 180, easing: "ease-out", fill: "forwards" },
    );
    void closeAnimation.current.finished.then(onClose, () => {});
  }

  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      closeAnimation.current?.cancel();
      closeAnimation.current = null;
      element?.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="photo-viewer"
      aria-label="沉浸式照片浏览"
      aria-describedby="viewer-caption"
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onKeyDown={(event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (
          event.shiftKey &&
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
            event.key,
          )
        ) {
          event.preventDefault();
          zoom.current?.pan(
            event.key === "ArrowLeft"
              ? 80
              : event.key === "ArrowRight"
                ? -80
                : 0,
            event.key === "ArrowUp" ? 80 : event.key === "ArrowDown" ? -80 : 0,
          );
          return;
        }
        if (["+", "=", "-", "0"].includes(event.key)) {
          event.preventDefault();
          if (event.key === "0") zoom.current?.reset();
          else zoom.current?.zoom(event.key === "-" ? 1 / 1.5 : 1.5);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          move(1);
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      <div className="viewer-header">
        <span>PHOTO ARCHIVE</span>
        <span className="viewer-counter" aria-live="polite">
          {String(index + 1).padStart(2, "0")} /{" "}
          {String(photos.length).padStart(2, "0")}
        </span>
        <button
          type="button"
          className="icon-button"
          onClick={requestClose}
          aria-label="关闭大图"
        >
          <Close />
        </button>
      </div>
      <div className="viewer-stage">
        <button
          type="button"
          className="icon-button viewer-prev"
          onClick={() => move(-1)}
          aria-label="上一张照片"
          disabled={photos.length < 2}
        >
          <Arrow direction="left" />
        </button>
        <ZoomablePhoto
          photo={photo}
          controls={zoom}
          onPrevious={() => move(-1)}
          onNext={() => move(1)}
        />
        <button
          type="button"
          className="icon-button viewer-next"
          onClick={() => move(1)}
          aria-label="下一张照片"
          disabled={photos.length < 2}
        >
          <Arrow />
        </button>
      </div>
      <div className="viewer-footer">
        <div id="viewer-caption">
          {photo.title && <h2>{photo.title}</h2>}
          <p>
            {[photo.location, photo.year].filter(Boolean).join(" · ")}
            {photo.isSample ? " · 示例编排" : ""}
          </p>
        </div>
        <div className="viewer-actions">
          <a className="info-button" href={`/media/${photo.id}/original`} download>
            下载原图
          </a>
          <button
            type="button"
            className="info-button"
            aria-expanded={showInfo}
            aria-controls="photo-info"
            onClick={() => setShowInfo(!showInfo)}
          >
            {showInfo ? "收起信息 −" : "照片信息 +"}
          </button>
        </div>
      </div>
      {showInfo && (
        <aside className="photo-info" id="photo-info">
          <h3>照片信息</h3>
          <dl>
            <div>
              <dt>题材</dt>
              <dd>{photo.category}</dd>
            </div>
            <div>
              <dt>原图尺寸</dt>
              <dd>
                {photo.width} × {photo.height}
              </dd>
            </div>
            <div>
              <dt>拍摄日期</dt>
              <dd>{photo.capturedAt || "尚未录入"}</dd>
            </div>
            <div>
              <dt>机身</dt>
              <dd>
                {[photo.cameraMake, photo.cameraModel]
                  .filter(Boolean)
                  .join(" / ") || "尚未录入"}
              </dd>
            </div>
            <div>
              <dt>镜头</dt>
              <dd>{photo.lensModel || "尚未录入"}</dd>
            </div>
            <div>
              <dt>拍摄参数</dt>
              <dd>
                {[
                  photo.focalLength,
                  photo.aperture,
                  photo.shutterSpeed,
                  photo.iso && `ISO ${photo.iso}`,
                ]
                  .filter(Boolean)
                  .join(" · ") || "尚未录入"}
              </dd>
            </div>
          </dl>
          {photo.tags.length > 0 && <p>{photo.tags.join(" · ")}</p>}
          {photo.description && <p>{photo.description}</p>}
          {photo.isSample && <p>此照片为网站演示素材。</p>}
          {photo.source && (
            <a href={photo.source} target="_blank" rel="noreferrer">
              查看 Unsplash 来源 ↗
            </a>
          )}
        </aside>
      )}
    </dialog>
  );
}
