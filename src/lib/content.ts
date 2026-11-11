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
export type PhotoLayout = {
  type: "full" | "center" | "pair";
  photoIds: string[];
};
export type ProjectPhotoInput = {
  photoId: string;
  layoutType: PhotoLayout["type"];
  caption: string;
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
