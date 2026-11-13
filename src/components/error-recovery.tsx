"use client";

import { useEffect, useTransition } from "react";
import { reportClientError } from "@/lib/monitoring-client";
import styles from "./error-recovery.module.css";
import { BrandLogo } from "./brand-logo";

export function ErrorRecovery({ error, retry, admin = false }: { error: unknown; retry: () => void; admin?: boolean }) {
  const [pending, startTransition] = useTransition();
  useEffect(() => { reportClientError(error, "render-error"); }, [error]);
  const digest = typeof error === "object" && error !== null && "digest" in error &&
    typeof error.digest === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(error.digest) ? error.digest : "";
  return (
    <section className={styles.recovery} aria-labelledby="recovery-title">
      <div className={styles.brand}><BrandLogo small /><p className={styles.eyebrow}>/ 暂时停留</p></div>
      <h1 id="recovery-title">这一页暂时未能展开。</h1>
      <p>{admin ? "管理页面加载遇到了问题。请重试；尚未保存的修改可能需要重新填写。" : "页面加载遇到了问题，请稍后重试，或回到所见继续浏览。"}</p>
      <div className={styles.actions}>
        <button type="button" disabled={pending} onClick={() => startTransition(retry)}>{pending ? "正在重试…" : "重新尝试"}</button>
        <button type="button" onClick={() => window.location.reload()}>刷新页面</button>
        <a href={admin ? "/admin/photos" : "/"}>{admin ? "返回照片管理" : "返回所见"} →</a>
      </div>
      <p role="status" aria-live="polite">{pending ? "正在重新加载页面…" : ""}</p>
      {digest && <p className={styles.reference}>问题编号：{digest}</p>}
    </section>
  );
}
