export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type PhotoTransform = Point & { scale: number };
export const initialTransform: PhotoTransform = { scale: 1, x: 0, y: 0 };

export function constrainTransform(
  view: PhotoTransform,
  photo: Size,
  viewport: Size,
): PhotoTransform {
  const scale = Math.min(4, Math.max(1, view.scale));
  const fit = Math.min(
    viewport.width / photo.width,
    viewport.height / photo.height,
  );
  const maxX = Math.max(0, (photo.width * fit * scale - viewport.width) / 2);
  const maxY = Math.max(0, (photo.height * fit * scale - viewport.height) / 2);
  return {
    scale,
    x: maxX === 0 ? 0 : Math.min(maxX, Math.max(-maxX, view.x)),
    y: maxY === 0 ? 0 : Math.min(maxY, Math.max(-maxY, view.y)),
  };
}
export function zoomAt(
  view: PhotoTransform,
  scale: number,
  anchor: Point,
  photo: Size,
  viewport: Size,
): PhotoTransform {
  const nextScale = Math.min(4, Math.max(1, scale));
  const ratio = nextScale / view.scale;
  return constrainTransform(
    {
      scale: nextScale,
      x: anchor.x - (anchor.x - view.x) * ratio,
      y: anchor.y - (anchor.y - view.y) * ratio,
    },
    photo,
    viewport,
  );
}
