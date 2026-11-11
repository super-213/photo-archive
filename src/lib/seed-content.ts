export { default as samplePhotos } from "./photos.json";

export const sampleProjects = [
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
