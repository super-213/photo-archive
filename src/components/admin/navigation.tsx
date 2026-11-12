"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { adminRequest } from "./api";
import { site } from "@/lib/content";

export function AdminNavigation() {
  const path = usePathname();
  const router = useRouter();
  const [error, setError] = useState("");
  return (
    <header className="admin-header">
      <Link href="/admin/photos" className="wordmark">
        {site.wordmark}
      </Link>
      <nav aria-label="管理导航">
        <Link
          href="/admin/photos"
          aria-current={path.startsWith("/admin/photos") ? "page" : undefined}
        >
          照片管理
        </Link>
        <Link
          href="/admin/projects"
          aria-current={path.startsWith("/admin/projects") ? "page" : undefined}
        >
          摄影系列
        </Link>
      </nav>
      <div>
        <Link href="/" target="_blank">
          查看网站 ↗
        </Link>
        <button
          onClick={async () => {
            try {
              await adminRequest("/api/auth/sign-out", "POST", {});
              router.replace("/admin");
              router.refresh();
            } catch {
              setError("退出失败，请重试");
            }
          }}
        >
          退出登录
        </button>
      </div>
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
    </header>
  );
}
