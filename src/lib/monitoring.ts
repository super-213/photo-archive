export const vitalNames = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export type VitalName = (typeof vitalNames)[number];
export const vitalDefinitions = {
  LCP: { label: "主要内容显示", good: 2500, poor: 4000 },
  INP: { label: "交互响应", good: 200, poor: 500 },
  CLS: { label: "布局偏移", good: 0.1, poor: 0.25 },
  FCP: { label: "首次内容显示", good: 1800, poor: 3000 },
  TTFB: { label: "首字节响应", good: 800, poor: 1800 },
} satisfies Record<VitalName, { label: string; good: number; poor: number }>;

export function vitalRating(name: VitalName, value: number): "good" | "needs-improvement" | "poor" {
  const limits = vitalDefinitions[name];
  return value <= limits.good ? "good" : value <= limits.poor ? "needs-improvement" : "poor";
}

// Store route patterns only: no queries, fragments, photo IDs or project names.
export function monitoringPath(input: string): string {
  const path = input.split(/[?#]/, 1)[0];
  if (["/", "/archive", "/works", "/admin", "/admin/photos", "/admin/projects", "/admin/projects/new", "/admin/monitoring"].includes(path)) return path;
  if (path.startsWith("/works/")) return "/works/[slug]";
  if (path.startsWith("/admin/projects/")) return "/admin/projects/[id]";
  if (path.startsWith("/api/admin/")) return "/api/admin/[route]";
  if (path.startsWith("/api/")) return "/api/[route]";
  if (path.startsWith("/media/")) return "/media/[id]/[variant]";
  if (path.startsWith("/share/")) return "/share/[slug]";
  return "/other";
}

export type TelemetryEvent = { id: string; path: string } & (
  { kind: "vital"; name: VitalName; value: number } |
  { kind: "error"; source: "client-error" | "unhandled-rejection" | "render-error";
    name: "Error" | "TypeError" | "RangeError" | "ReferenceError" | "SyntaxError" | "OtherError"; digest: string }
);
