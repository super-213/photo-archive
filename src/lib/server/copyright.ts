import "server-only";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { previewEncodingVersion } from "../media-settings";

const run = promisify(execFile);
const exiftoolPath: string = createRequire(import.meta.url)("exiftool-vendored.pl");

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export type CopyrightSettings = {
  author: string;
  notice: string;
  version: number;
  previewVersion: number;
};

function configurationVersion(value: unknown) {
  return Number.parseInt(createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12), 16);
}

export function getCopyrightSettings(): CopyrightSettings | undefined {
  const author = (process.env.PHOTO_ARCHIVE_COPYRIGHT_AUTHOR || "").trim();
  const notice = (process.env.PHOTO_ARCHIVE_COPYRIGHT_NOTICE || "").trim();
  if (!author && !notice) return undefined;
  return {
    author,
    notice,
    version: configurationVersion(["copyright-1", author, notice]),
    previewVersion: configurationVersion(["preview-1", previewEncodingVersion, author, notice]),
  };
}

export function createCopyrightXmp(settings: CopyrightSettings) {
  const creator = settings.author
    ? `<dc:creator><rdf:Seq><rdf:li>${escapeXml(settings.author)}</rdf:li></rdf:Seq></dc:creator>`
    : "";
  const rights = settings.notice
    ? `<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(settings.notice)}</rdf:li></rdf:Alt></dc:rights>`
    : "";
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      ${creator}
      ${rights}
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;
}

export async function writePreviewCopyright(
  source: string,
  destination: string,
  settings: CopyrightSettings | undefined,
) {
  // ExifTool rewrites metadata without recompressing the WebP image or changing ICC.
  const tags = ["-XMP:All=", "-EXIF:All="];
  if (settings?.author) tags.push(`-XMP-dc:Creator=${settings.author}`);
  if (settings?.notice) tags.push(`-XMP-dc:Rights=${settings.notice}`);
  await run(exiftoolPath, [
    "-charset", "filename=UTF8", ...tags, "-o", destination, source,
  ], { timeout: 120_000, maxBuffer: 1024 * 1024 });
}
