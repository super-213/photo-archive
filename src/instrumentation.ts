export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startFolderImporter } = await import("./lib/server/folder-import");
    const { startPreviewCachePurgeWorker } = await import("./lib/server/cdn-cache");
    const { startOriginalCleanupWorker } = await import("./lib/server/original-cleanup");
    startOriginalCleanupWorker();
    startFolderImporter();
    startPreviewCachePurgeWorker();
  }
}
