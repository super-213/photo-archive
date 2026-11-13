import { telemetryInput } from "@/lib/server/monitoring-input";
import { publicSiteUrl } from "@/lib/seo";
import { apiAction, readBody, requireSameOrigin } from "@/lib/server/http";
import { recordTelemetry } from "@/lib/server/monitoring";

export const runtime = "nodejs";
let windowStarted = 0;
let requests = 0;

export async function POST(request: Request) {
  return apiAction(async () => {
    const publicUrl = publicSiteUrl();
    const host = request.headers.get("host") || new URL(request.url).host;
    if (!publicUrl || host !== publicUrl.host || request.headers.get("origin") !== publicUrl.origin)
      requireSameOrigin(request);
    const now = Date.now();
    if (now - windowStarted >= 60_000) { windowStarted = now; requests = 0; }
    if (++requests > 1200) return new Response(null, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
    const event = telemetryInput.parse(JSON.parse((await readBody(request, 4096)).toString("utf8")));
    // Exclude management activity from public site performance distributions.
    if (event.kind !== "vital" || !event.path.startsWith("/admin")) {
      try { recordTelemetry(event); }
      catch { console.error("[运行监测] 浏览器数据保存失败"); }
    }
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  });
}
