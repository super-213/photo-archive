export { default as samplePhotos } from "./photos.json";

export const sampleProjects = [
  {
    slug: "stillness",
    title: "山水之间",
    subtitle: "",
    description: "沿着湖岸，走入山间。把目光留给辽阔，也留给安静的片刻。",
    category: "Landscape",
    year: "2024—2025",
    coverPhotoId: "fuji",
    layouts: [
      { type: "full", photoIds: ["fuji"] },
      { type: "asymmetric", photoIds: ["lakeside", "curve"] },
      { type: "triptych", photoIds: ["peak", "alpine", "mist"] },
    ],
  },
  {
    slug: "after-hours",
    title: "城市入夜以后",
    subtitle: "",
    description: "灯亮起，雨落下。在人群经过的地方，收集城市的另一种表情。",
    category: "Street",
    year: "2024—2025",
    coverPhotoId: "rain",
    layouts: [
      { type: "center", photoIds: ["rain"] },
      { type: "large-small", photoIds: ["alley", "lanterns"] },
      { type: "triptych", photoIds: ["crossing", "kyoto", "neon"] },
    ],
  },
  {
    slug: "small-worlds",
    title: "微小世界",
    subtitle: "",
    description: "缩小尺度，靠近细节。让一辆小车，驶入想象中的风景。",
    category: "Miniature",
    year: "2024—2025",
    coverPhotoId: "gtr",
    layouts: [
      { type: "full", photoIds: ["gtr"] },
      { type: "triptych", photoIds: ["beetle", "blue", "white"] },
      { type: "large-small", photoIds: ["black", "red"] },
    ],
  },
];
