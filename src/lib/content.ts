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
  name: "片隅",
  wordmark: "片隅.",
  tagline: "A PERSONAL PHOTOGRAPHY COLLECTION",
  description: "片隅，个人摄影收藏。所见，精选摄影系列；所藏，留存拍摄的瞬间。",
};

export type Photo = {
  id: string;
  src: string;
  lightboxSrc: string;
  thumbnailSrc: string;
  previewSrc?: string;
  downloadSrc?: string;
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
export type PhotoSource = Pick<Photo,
  "src" | "lightboxSrc" | "thumbnailSrc" | "previewSrc" | "width" | "height"
>;
export type PhotoPreload = { photo: PhotoSource; sizes: string };
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
export const coverLayouts = ["lead", "offset", "wide"] as const;
export const coverLayoutLabels = {
  lead: "左侧大图",
  offset: "右侧错位小图",
  wide: "居中宽图",
} as const;
export const coverRatios = ["original", "landscape", "portrait", "wide"] as const;
export const coverRatioLabels = {
  original: "照片原比例",
  landscape: "横幅 3∶2",
  portrait: "竖幅 4∶5",
  wide: "宽幅 16∶9",
} as const;
export const coverAspectRatios = {
  landscape: "3 / 2",
  portrait: "4 / 5",
  wide: "16 / 9",
} as const;
export type CoverSettings = {
  coverLayout: (typeof coverLayouts)[number];
  coverRatio: (typeof coverRatios)[number];
  coverFocusX: number;
  coverFocusY: number;
};

export type Project = CoverSettings & {
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

export const archivePageSize = 24;

export type PhotoPage = {
  photos: Photo[];
  total: number;
  nextCursor: string | null;
};

export type ProjectCoverData = CoverSettings & {
  slug: string;
  title: string;
  subtitle: string;
  cover: Photo;
  previews: PhotoPreload[];
};
