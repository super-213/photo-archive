import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const logo = await readFile("public/logo.svg");
const lightLogo = await readFile("public/logo-light.svg", "utf8");
// Browser tabs use the supplied light mark with its original transparent background.
await writeFile("src/app/icon.svg", lightLogo);

// ICO wraps PNG data for compatibility with browsers that do not select SVGs.
const fallback = await sharp(Buffer.from(lightLogo)).resize(32, 32).png().toBuffer();
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
icoHeader[6] = 32;
icoHeader[7] = 32;
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(fallback.length, 14);
icoHeader.writeUInt32LE(22, 18);
await writeFile("src/app/favicon.ico", Buffer.concat([icoHeader, fallback]));
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
console.log("已生成透明底浅色标签页图标、PWA 安装图标与 Apple 主屏幕图标");
