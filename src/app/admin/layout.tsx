import type { Metadata } from "next";
import "./admin.css";
export const metadata: Metadata = {
  title: "内容管理",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
