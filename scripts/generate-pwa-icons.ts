import { mkdir, readFile } from "node:fs/promises";
import sharp from "sharp";

const logo = await readFile("public/logo.svg");
await mkdir("public/pwa", { recursive: true });
for (const size of [192, 512]) {
  await sharp(logo).resize(size, size).flatten({ background: "#f7f6f2" }).png()
    .toFile(`public/pwa/icon-${size}.png`);
}
// Keep the entire square symbol inside Android's central 80% safe circle.
const maskableLogo = await sharp(logo).resize(368, 368).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 3, background: "#f7f6f2" } })
  .composite([{ input: maskableLogo, left: 72, top: 72 }]).removeAlpha().png().toFile("public/pwa/icon-maskable-512.png");
await sharp(logo).resize(180, 180).flatten({ background: "#f7f6f2" }).png().toFile("src/app/apple-icon.png");
console.log("已生成 PWA 安装图标与 Apple 主屏幕图标");
