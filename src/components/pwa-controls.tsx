"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./pwa-controls.module.css";

type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function PwaControls() {
  const [mounted, setMounted] = useState(false);
  const [secure, setSecure] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const reloadRequested = useRef(false);

  useEffect(() => {
    setMounted(true);
    setSecure(window.isSecureContext);
    const standalone = window.matchMedia("(display-mode: standalone)");
    const isInstalled = () => setInstalled(standalone.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    isInstalled();
    standalone.addEventListener("change", isInstalled);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    let cancelled = false;
    let registration: ServiceWorkerRegistration | undefined;
    let installing: ServiceWorker | null = null;
    const checkWaiting = () => {
      if (!cancelled && navigator.serviceWorker.controller) setWaiting(registration?.waiting || null);
    };
    const onUpdate = () => {
      installing?.removeEventListener("statechange", checkWaiting);
      installing = registration?.installing || null;
      installing?.addEventListener("statechange", checkWaiting);
    };
    const onControllerChange = () => {
      if (reloadRequested.current && !location.pathname.startsWith("/admin")) location.reload();
    };
    let lastChecked = Date.now();
    const checkForUpdate = () => {
      if (document.visibilityState !== "visible" || !registration || Date.now() - lastChecked < 60 * 60 * 1000) return;
      lastChecked = Date.now();
      void registration.update().catch(() => {});
    };
    const register = () => {
      void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((result) => {
        if (cancelled) return;
        registration = result;
        checkWaiting();
        registration.addEventListener("updatefound", onUpdate);
        onUpdate();
      }).catch(() => {
        if (!cancelled) setMessage("离线提示暂不可用，联网浏览不受影响。");
      });
    };
    const enableWorker = process.env.NODE_ENV === "production" && window.isSecureContext && "serviceWorker" in navigator;
    if (enableWorker) {
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
      document.addEventListener("visibilitychange", checkForUpdate);
      if (document.readyState === "complete") register();
      else window.addEventListener("load", register, { once: true });
    }
    return () => {
      cancelled = true;
      standalone.removeEventListener("change", isInstalled);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("load", register);
      registration?.removeEventListener("updatefound", onUpdate);
      installing?.removeEventListener("statechange", checkWaiting);
      if (enableWorker) navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", checkForUpdate);
    };
  }, []);

  async function install() {
    if (!prompt || busy) return;
    const deferred = prompt;
    setPrompt(null);
    setBusy(true);
    setMessage("");
    try {
      await deferred.prompt();
      if ((await deferred.userChoice).outcome === "accepted") setInstalled(true);
    } catch { setMessage("请通过浏览器菜单安装片隅。"); }
    finally { setBusy(false); }
  }

  if (!mounted) return null;
  return (
    <div className={styles.controls}>
      {!installed && (prompt ? (
        <button type="button" className={styles.action} disabled={busy} onClick={() => void install()}>安装片隅 ↗</button>
      ) : (
        <details className={styles.help}>
          <summary>安装片隅 ↗</summary>
          <p>{secure ? "在浏览器菜单或分享菜单中，选择“安装应用”“添加到主屏幕”或“添加到程序坞”。iPhone / iPad 可使用 Safari 分享菜单。" : "请通过本站的 HTTPS 地址访问后安装。"}</p>
        </details>
      ))}
      {waiting && <div className={styles.update}>
        <span role="status">新版本已准备好</span>
        <button type="button" className={styles.action} disabled={busy} onClick={() => {
          if (waiting.state !== "installed") { setWaiting(null); return; }
          reloadRequested.current = true;
          setBusy(true);
          waiting.postMessage({ type: "SKIP_WAITING" });
        }}>更新应用</button>
      </div>}
      {message && <p role="status" className={styles.message}>{message}</p>}
    </div>
  );
}
