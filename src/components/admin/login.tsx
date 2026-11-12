"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminRequest } from "./api";
import { site } from "@/lib/content";

export function AdminLogin({
  configured,
  development,
}: {
  configured: boolean;
  development: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="admin-login">
      <a href="/" className="wordmark">
        {site.wordmark}
      </a>
      <div>
        <p className="eyebrow">内容管理</p>
        <h1>管理员登录</h1>
        <p className="admin-muted">管理照片，编排与发布摄影系列。</p>
      </div>
      {development && (
        <p className="admin-notice">本地开发账号和密码均为 admin，点击登录即可。</p>
      )}
      {!configured && (
        <p className="admin-notice">
          首次使用请在本机终端运行 <code>npm run admin:create</code>{" "}
          创建管理员。
        </p>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          const data = new FormData(event.currentTarget);
          try {
            await adminRequest("/api/auth/sign-in/email", "POST", {
              email: data.get("email"),
              password: data.get("password"),
            });
            router.replace("/admin/photos");
            router.refresh();
          } catch (error) {
            setError(error instanceof Error ? error.message : "登录失败，请稍后重试。");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {development ? "账号" : "邮箱"}
          <input
            type={development ? "text" : "email"}
            name="email"
            defaultValue={development ? "admin" : ""}
            autoComplete="username"
            required
            disabled={busy}
          />
        </label>
        <label>
          密码
          <input
            type="password"
            name="password"
            defaultValue={development ? "admin" : ""}
            autoComplete="current-password"
            required
            disabled={busy}
          />
        </label>
        {error && (
          <p role="alert" className="admin-error">
            {error}
          </p>
        )}
        <button className="admin-button" disabled={busy || !configured}>
          {busy ? "正在登录…" : "登录"}
        </button>
      </form>
      <a href="/" className="text-link">
        ← 返回作品集
      </a>
    </div>
  );
}
