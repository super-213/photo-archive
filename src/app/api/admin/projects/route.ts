import { apiAction, json, requireAdministrator } from "@/lib/server/http";
import { listProjects, saveProject } from "@/lib/server/store";
import { projectInput } from "@/lib/server/validation";

export async function GET(request: Request) {
  return apiAction(async () => {
    await requireAdministrator(request);
    return json(listProjects(false));
  });
}
export async function POST(request: Request) {
  return apiAction(async () => {
    await requireAdministrator(request);
    return json(
      saveProject(null, projectInput.parse(await request.json())),
      201,
    );
  });
}
