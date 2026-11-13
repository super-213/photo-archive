"use client";

import { ErrorRecovery } from "@/components/error-recovery";

export default function GlobalError(props: { error: unknown; retry: () => void }) {
  return (
    <html lang="zh-CN">
      <head><title>页面暂时无法加载 | 片隅</title><meta name="robots" content="noindex" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
      <body style={{ margin: 0, background: "#f7f6f2", minHeight: "100dvh" }}>
        <ErrorRecovery {...props} />
      </body>
    </html>
  );
}
