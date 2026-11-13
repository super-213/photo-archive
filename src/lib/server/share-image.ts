import "server-only";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function renderShareImage(photo?: Buffer) {
  const logo = await readFile(path.join(process.cwd(), "public", "logo.svg"));
  const frame = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <rect width="1200" height="630" fill="#f7f6f2"/>
    <path d="M48 550H1152" stroke="#dedbd4"/>
    <text x="118" y="596" fill="#202020" font-family="serif" font-size="30" letter-spacing="5">PIANYU.</text>
    <text x="1152" y="590" text-anchor="end" fill="#66645f" font-family="sans-serif" font-size="13" letter-spacing="2">A PERSONAL PHOTOGRAPHY COLLECTION</text>
    ${photo ? "" : `<rect x="48" y="48" width="1104" height="464" fill="#e7e5dc"/>
    <text x="600" y="468" text-anchor="middle" fill="#66645f" font-family="sans-serif" font-size="13" letter-spacing="4">PHOTO ARCHIVE</text>`}
  </svg>`);
  const layers = photo ? [{ input: await sharp(photo).resize(1104, 464, {
    fit: "contain", background: "#f7f6f2",
  }).toBuffer(), left: 48, top: 48 }] : [{ input: await sharp(logo).resize(300, 300).png().toBuffer(), left: 450, top: 100 }];
  layers.push({ input: await sharp(logo).resize(60, 60).png().toBuffer(), left: 40, top: 558 });
  return sharp(frame).composite(layers).jpeg({ quality: 90 }).toBuffer();
}

export function shareImageResponse(bytes: Buffer) {
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": "image/jpeg", "Cache-Control": "private, no-store",
    "Cloudflare-CDN-Cache-Control": "no-store", "X-Robots-Tag": "noindex",
    "X-Content-Type-Options": "nosniff",
  } });
}
