export const categories = [
  "Landscape",
  "Street",
  "Travel",
  "People",
  "Automotive",
  "Miniature",
] as const;
export type Category = (typeof categories)[number];
export const categoryLabels: Record<Category, string> = {
  Landscape: "风光",
  Street: "街拍",
  Travel: "旅行",
  People: "人文",
  Automotive: "汽车",
  Miniature: "模型",
};
export const site = {
  name: "Photo Archive",
  description: "风光、街巷与微小世界。一个持续生长的摄影作品集。",
};

export type Photo = {
  id: string;
  src: string;
  lightboxSrc: string;
  thumbnailSrc: string;
  title: string;
  alt: string;
  description: string;
  width: number;
  height: number;
  category: Category;
  year: string;
  location: string;
  source: string;
  visibility: "draft" | "public" | "private";
  capturedAt: string;
  cameraMake: string;
  cameraModel: string;
  lensModel: string;
  focalLength: string;
  aperture: string;
  shutterSpeed: string;
  iso: string;
  tags: string[];
  isSample: boolean;
  version: number;
};
export const layoutTypes = [
  "full",
  "center",
  "pair",
  "asymmetric",
  "large-small",
  "triptych",
] as const;
export type LayoutType = (typeof layoutTypes)[number];
export const layoutDefinitions: Record<
  LayoutType,
  { label: string; capacity: number }
> = {
  full: { label: "全宽", capacity: 1 },
  center: { label: "居中", capacity: 1 },
  pair: { label: "双图", capacity: 2 },
  asymmetric: { label: "错位双图", capacity: 2 },
  "large-small": { label: "一大一小", capacity: 2 },
  triptych: { label: "三联", capacity: 3 },
};
export type PhotoLayout = {
  id: string;
  type: LayoutType;
  photoIds: string[];
};
export type ProjectPhotoInput = {
  photoId: string;
  layoutType: PhotoLayout["type"];
  caption: string;
  groupId?: string;
};
export type Project = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  category: Category;
  year: string;
  coverPhotoId: string;
  status: "draft" | "published";
  sortOrder: number;
  version: number;
  photos: Photo[];
  items: ProjectPhotoInput[];
  layouts: PhotoLayout[];
};
export function getProjectPhotos(project: Project) {
  return project.photos;
}
export function getCover(project: Project) {
  return project.photos.find((photo) => photo.id === project.coverPhotoId);
}

export function buildPhotoLayouts(items: ProjectPhotoInput[]): PhotoLayout[] {
  const layouts: PhotoLayout[] = [];
  let previousWasLegacy = false;
  for (const item of items) {
    const previous = layouts.at(-1);
    const sameGroup = item.groupId
      ? previous?.id === item.groupId
      : previousWasLegacy && previous?.type === item.layoutType;
    if (
      previous &&
      sameGroup &&
      previous.type === item.layoutType &&
      previous.photoIds.length < layoutDefinitions[item.layoutType].capacity
    ) {
      previous.photoIds.push(item.photoId);
    } else {
      layouts.push({
        id: item.groupId || `legacy-${item.photoId}`,
        type: item.layoutType,
        photoIds: [item.photoId],
      });
    }
    previousWasLegacy = !item.groupId;
  }
  return layouts;
}
