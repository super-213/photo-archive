import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAdministrator } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";
import { AdminLogin } from "@/components/admin/login";

export default async function AdminPage() {
  if (await getAdministrator(await headers())) redirect("/admin/photos");
  return (
    <AdminLogin
      configured={Boolean(
        getDatabase().prepare("SELECT 1 FROM administrator LIMIT 1").get(),
      )}
    />
  );
}
