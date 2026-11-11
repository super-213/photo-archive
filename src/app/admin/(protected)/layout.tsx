import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAdministrator } from "@/lib/server/auth";
import { AdminNavigation } from "@/components/admin/navigation";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await getAdministrator(await headers()))) redirect("/admin");
  return (
    <div className="admin-shell">
      <AdminNavigation />
      <div className="admin-content">{children}</div>
    </div>
  );
}
