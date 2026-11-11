import { apiAction, json, requireAdministrator } from "@/lib/server/http";
import { updatePhoto } from "@/lib/server/store";
import { photoInput } from "@/lib/server/validation";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return apiAction(async () => {
    await requireAdministrator(request);
    const { id } = await context.params;
    return json(updatePhoto(id, photoInput.parse(await request.json())));
  });
}
