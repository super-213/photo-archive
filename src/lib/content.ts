import photoData from "./photos.json";

export const categories = ["Landscape", "Street", "Miniature"] as const;
export type Category = (typeof categories)[number];
export const categoryLabels: Record<Category, string> = {
  Landscape: "风光",
  Street: "街拍",
  Miniature: "模型",
};

export type Photo = {
  id: string;
  src: string;
  title: string;
  alt: string;
  width: number;
  height: number;
  category: Category;
  year: string;
  location: string;
  source: string;
  visibility: "draft" | "public" | "private";
};

export type PhotoLayout = {
  type: "full" | "center" | "pair";
  photoIds: string[];
};
export type Project = {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  category: Category;
  year: string;
  coverPhotoId: string;
  layouts: PhotoLayout[];
};

export const site = {
  name: "Photo Archive",
  description: "风光、街巷与微小世界。一个持续生长的摄影作品集。",
};
export const photos = photoData as Photo[];
export const publicPhotos = photos.filter(
  (photo) => photo.visibility === "public",
);
export const years = [...new Set(publicPhotos.map((photo) => photo.year))]
  .sort()
  .reverse();

export const projects: Project[] = [
  {
    slug: "stillness",
    title: "The shape of stillness",
    subtitle: "山水之间",
    description: "沿着湖岸，走入山间。把目光留给辽阔，也留给安静的片刻。",
    category: "Landscape",
    year: "2024—2025",
    coverPhotoId: "fuji",
    layouts: [
      { type: "full", photoIds: ["fuji"] },
      { type: "pair", photoIds: ["lakeside", "curve"] },
      { type: "center", photoIds: ["peak"] },
      { type: "pair", photoIds: ["alpine", "mist"] },
    ],
  },
  {
    slug: "after-hours",
    title: "After hours",
    subtitle: "城市入夜以后",
    description: "灯亮起，雨落下。在人群经过的地方，收集城市的另一种表情。",
    category: "Street",
    year: "2024—2025",
    coverPhotoId: "rain",
    layouts: [
      { type: "center", photoIds: ["rain"] },
      { type: "pair", photoIds: ["alley", "lanterns"] },
      { type: "full", photoIds: ["crossing"] },
      { type: "pair", photoIds: ["kyoto", "neon"] },
    ],
  },
  {
    slug: "small-worlds",
    title: "Small worlds",
    subtitle: "微小世界",
    description: "缩小尺度，靠近细节。让一辆小车，驶入想象中的风景。",
    category: "Miniature",
    year: "2024—2025",
    coverPhotoId: "gtr",
    layouts: [
      { type: "full", photoIds: ["gtr"] },
      { type: "pair", photoIds: ["beetle", "blue"] },
      { type: "center", photoIds: ["white"] },
      { type: "pair", photoIds: ["black", "red"] },
    ],
  },
];

export function getPhoto(id: string) {
  const photo = publicPhotos.find((item) => item.id === id);
  if (!photo) throw new Error(`Public photograph ${id} is unavailable`);
  return photo;
}

export function getProjectPhotos(project: Project) {
  return project.layouts.flatMap((layout) => layout.photoIds.map(getPhoto));
}
