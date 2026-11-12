import { z } from "zod";
import { apiAction, json, readJson, requireAdministrator } from "@/lib/server/http";
import { deleteProject, saveProject } from "@/lib/server/store";
import { projectInput } from "@/lib/server/validation";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return apiAction(async () => {
    await requireAdministrator(request);
    const { id } = await context.params;
    return json(saveProject(id, projectInput.parse(await readJson(request))));
  });
}
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return apiAction(async () => {
    await requireAdministrator(request);
    const { id } = await context.params;
    const { version } = z
      .object({ version: z.number().int().positive() })
      .parse(await readJson(request));
    deleteProject(id, version);
    return json({ ok: true });
  });
}
