"use client";

import Image from "next/image";
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
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [index, setIndex] = useState(initialIndex);
  const [showInfo, setShowInfo] = useState(false);
  const photo = photos[index];
  const move = useCallback(
    (step: number) =>
      setIndex((current) => (current + step + photos.length) % photos.length),
    [photos.length],
  );

  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
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
        onClose();
      }}
      onKeyDown={(event) => {
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
        <button className="icon-button" onClick={onClose} aria-label="关闭大图">
          <Close />
        </button>
      </div>
      <div
        className="viewer-stage"
        onTouchStart={(event) => {
          if (event.touches.length === 1)
            touchStart.current = {
              x: event.touches[0].clientX,
              y: event.touches[0].clientY,
            };
          else touchStart.current = null;
        }}
        onTouchEnd={(event) => {
          if (!touchStart.current) return;
          const dx = event.changedTouches[0].clientX - touchStart.current.x;
          const dy = event.changedTouches[0].clientY - touchStart.current.y;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5)
            move(dx < 0 ? 1 : -1);
          touchStart.current = null;
        }}
      >
        <button
          className="icon-button viewer-prev"
          onClick={() => move(-1)}
          aria-label="上一张照片"
          disabled={photos.length < 2}
        >
          <Arrow direction="left" />
        </button>
        <div className="viewer-image">
          <Image
            key={photo.id}
            src={photo.src}
            alt={photo.alt}
            fill
            sizes="100vw"
            loading="eager"
          />
        </div>
        <button
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
          <h2>{photo.title}</h2>
          <p>
            {photo.location} · {photo.year} 示例编排
          </p>
        </div>
        <button
          className="info-button"
          aria-expanded={showInfo}
          aria-controls="photo-info"
          onClick={() => setShowInfo(!showInfo)}
        >
          {showInfo ? "收起信息 −" : "照片信息 +"}
        </button>
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
              <dt>展示尺寸</dt>
              <dd>
                {photo.width} × {photo.height}
              </dd>
            </div>
            <div>
              <dt>拍摄日期</dt>
              <dd>尚未录入</dd>
            </div>
            <div>
              <dt>器材 / EXIF</dt>
              <dd>尚未录入</dd>
            </div>
          </dl>
          <p>此照片为网站演示素材。</p>
          <a href={photo.source} target="_blank" rel="noreferrer">
            查看 Unsplash 来源 ↗
          </a>
        </aside>
      )}
    </dialog>
  );
}
