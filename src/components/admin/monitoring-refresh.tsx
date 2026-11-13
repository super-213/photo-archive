"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function MonitoringRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button type="button" className="admin-small-button" disabled={pending}
    onClick={() => startTransition(() => router.refresh())}>{pending ? "正在刷新…" : "刷新数据"}</button>;
}
