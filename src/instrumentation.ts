import type { Instrumentation } from "next";

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

export const onRequestError: Instrumentation.onRequestError = async (error, request) => {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  try {
    const { recordServerError } = await import("./lib/server/monitoring");
    recordServerError(error, request.path);
  } catch { console.error("[运行监测] 服务端监测初始化失败"); }
};
