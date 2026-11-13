"use client";

import { useReportWebVitals } from "next/web-vitals";
import { sendTelemetry } from "@/lib/monitoring-client";
import { monitoringPath } from "@/lib/monitoring";

// The callback stays stable. Without soft-navigation attribution, Web Vitals
// describe the document load, not whichever client route is open when sent.
const documentPath = typeof window === "undefined" ? "/" : location.pathname;
const report: Parameters<typeof useReportWebVitals>[0] = (metric) => {
  let path = documentPath;
  if ("navigationURL" in metric && typeof metric.navigationURL === "string") {
    try { path = new URL(metric.navigationURL, location.origin).pathname; } catch { /* Use document path. */ }
  }
  if (path.startsWith("/admin")) return;
  sendTelemetry({ kind: "vital", id: metric.id, path: monitoringPath(path), name: metric.name, value: metric.value });
};

export function WebVitals() {
  useReportWebVitals(report);
  return null;
}
