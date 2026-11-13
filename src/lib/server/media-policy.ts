import "server-only";

export function originalDownloadsEnabled() {
  const value = (process.env.PHOTO_ARCHIVE_ORIGINAL_DOWNLOAD || "false").trim().toLowerCase();
  if (value !== "true" && value !== "false")
    throw new Error("PHOTO_ARCHIVE_ORIGINAL_DOWNLOAD 必须填写 true 或 false");
  return value === "true";
}
