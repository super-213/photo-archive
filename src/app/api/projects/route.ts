import { json } from "@/lib/server/http";
import { listProjects } from "@/lib/server/store";
export const dynamic = "force-dynamic";
export function GET() {
  return json(listProjects());
}
