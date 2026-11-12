"use client";

import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";
import type { Photo } from "@/lib/content";
import {
  constrainTransform,
  initialTransform,
  zoomAt,
  type PhotoTransform,
  type Point,
} from "@/lib/photo-zoom";
import { PhotoImage } from "./photo-image";

export type ZoomControls = {
  zoom: (factor: number) => void;
  reset: () => void;
  pan: (x: number, y: number) => void;
};
type PointerPosition = Point & { pointerType: string };
type Gesture = {
  view: PhotoTransform;
  start: PointerPosition;
  center: Point;
  distance: number;
  pinched: boolean;
};

export function ZoomablePhoto({
  photo,
  controls,
  onPrevious,
  onNext,
}: {
  photo: Photo;
  controls: RefObject<ZoomControls | null>;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(initialTransform);
  const current = useRef(initialTransform);
  const frame = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const size = useRef(viewport);
  const pointers = useRef(new Map<number, PointerPosition>());
  const gesture = useRef<Gesture | null>(null);

  function scheduleView() {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setView(current.current);
    });
  }
  function update(next: PhotoTransform) {
    current.current = constrainTransform(next, photo, size.current);
    scheduleView();
  }
  function reset() {
    update(initialTransform);
    pointers.current.clear();
    gesture.current = null;
  }
  function zoom(factor: number) {
    update(
      zoomAt(
        current.current,
        current.current.scale * factor,
        { x: 0, y: 0 },
        photo,
        size.current,
      ),
    );
    startGesture(gesture.current?.pinched);
  }
  function pan(x: number, y: number) {
    update({
      ...current.current,
      x: current.current.x + x,
      y: current.current.y + y,
    });
    startGesture(gesture.current?.pinched);
  }
  function localPoint(point: Point): Point {
    const rect = canvas.current!.getBoundingClientRect();
    return {
      x: point.x - rect.left - rect.width / 2,
      y: point.y - rect.top - rect.height / 2,
    };
  }
  function startGesture(pinched = false) {
    const points = [...pointers.current.values()];
    if (!points.length) {
      gesture.current = null;
      return;
    }
    const second = points[1] || points[0];
    gesture.current = {
      view: current.current,
      start: points[0],
      center: localPoint({
        x: (points[0].x + second.x) / 2,
        y: (points[0].y + second.y) / 2,
      }),
      distance: Math.hypot(second.x - points[0].x, second.y - points[0].y),
      pinched: pinched || points.length > 1,
    };
  }
  useImperativeHandle(controls, () => ({ zoom, reset, pan }));

  useLayoutEffect(() => {
    const element = canvas.current!;
    pointers.current.clear();
    gesture.current = null;
    current.current = initialTransform;
    setView(initialTransform);
    function measure() {
      const rect = element.getBoundingClientRect();
      size.current = { width: rect.width, height: rect.height };
      setViewport(size.current);
      current.current = constrainTransform(
        current.current,
        photo,
        size.current,
      );
      setView(current.current);
      startGesture(gesture.current?.pinched);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    function wheel(event: WheelEvent) {
      event.preventDefault();
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? size.current.height
            : 1);
      current.current = zoomAt(
        current.current,
        current.current.scale * Math.exp(-delta * 0.002),
        localPoint({ x: event.clientX, y: event.clientY }),
        photo,
        size.current,
      );
      scheduleView();
      startGesture(gesture.current?.pinched);
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      observer.disconnect();
      element.removeEventListener("wheel", wheel);
      pointers.current.clear();
    };
  }, [photo.id, photo.width, photo.height]);

  function endPointer(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const start = gesture.current;
    const tracked = pointers.current.has(event.pointerId);
    pointers.current.delete(event.pointerId);
    if (
      tracked &&
      start &&
      !cancelled &&
      !start.pinched &&
      start.start.pointerType !== "mouse" &&
      start.view.scale <= 1 &&
      current.current.scale <= 1
    ) {
      const dx = event.clientX - start.start.x;
      const dy = event.clientY - start.start.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) onNext();
        else onPrevious();
      }
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    startGesture(start?.pinched);
  }

  return (
    <div className="zoomable-photo">
      <div
        className="viewer-canvas"
        ref={canvas}
        tabIndex={0}
        role="group"
        aria-label={`${photo.title || "照片"}，双击或加减键缩放，0 复位，Shift 加方向键平移`}
        data-zoomed={view.scale > 1}
        onDragStart={(event) => event.preventDefault()}
        onDoubleClick={(event) =>
          update(
            zoomAt(
              current.current,
              current.current.scale > 1 ? 1 : 2,
              localPoint({ x: event.clientX, y: event.clientY }),
              photo,
              size.current,
            ),
          )
        }
        onPointerDown={(event) => {
          if (
            (event.pointerType === "mouse" && event.button !== 0) ||
            pointers.current.size >= 2
          )
            return;
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
            pointerType: event.pointerType,
          });
          startGesture(gesture.current?.pinched);
        }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId) || !gesture.current)
            return;
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
            pointerType: event.pointerType,
          });
          const points = [...pointers.current.values()];
          const start = gesture.current;
          if (points.length === 2 && start.distance > 0) {
            const distance = Math.hypot(
              points[1].x - points[0].x,
              points[1].y - points[0].y,
            );
            const center = localPoint({
              x: (points[0].x + points[1].x) / 2,
              y: (points[0].y + points[1].y) / 2,
            });
            const next = zoomAt(
              start.view,
              (start.view.scale * distance) / start.distance,
              start.center,
              photo,
              size.current,
            );
            update({
              ...next,
              x: next.x + center.x - start.center.x,
              y: next.y + center.y - start.center.y,
            });
          } else if (current.current.scale > 1) {
            update({
              ...start.view,
              x: start.view.x + event.clientX - start.start.x,
              y: start.view.y + event.clientY - start.start.y,
            });
          }
        }}
        onPointerUp={endPointer}
        onPointerCancel={(event) => endPointer(event, true)}
        onLostPointerCapture={(event) => {
          if (pointers.current.has(event.pointerId)) endPointer(event, true);
        }}
      >
        <div
          className="zoom-surface"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        >
          <img
            className="viewer-preview"
            src={photo.thumbnailSrc}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <PhotoImage
            key={photo.id}
            photo={photo}
            variant="lightbox"
            fill
            sizes={`${Math.ceil(Math.min(viewport.width, viewport.height * photo.width / photo.height) * view.scale)}px`}
            loading="eager"
            fetchPriority="high"
          />
        </div>
      </div>
      <div className="viewer-zoom-controls" role="group" aria-label="图片缩放">
        <button
          type="button"
          aria-label="缩小照片"
          disabled={view.scale <= 1}
          onClick={() => zoom(1 / 1.5)}
        >
          −
        </button>
        <button type="button" aria-label="重置缩放" onClick={reset}>
          <span aria-live="polite" aria-atomic="true">
            {Math.round(view.scale * 100)}%
          </span>
        </button>
        <button
          type="button"
          aria-label="放大照片"
          disabled={view.scale >= 4}
          onClick={() => zoom(1.5)}
        >
          +
        </button>
      </div>
    </div>
  );
}
