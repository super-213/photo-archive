import { apiAction, json, readJson, requireAdministrator } from "@/lib/server/http";
import { updatePhoto } from "@/lib/server/store";
import { photoInput, photoPatchInput } from "@/lib/server/validation";
import { randomUUID } from "node:crypto";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return savePhoto(request, context, false);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return savePhoto(request, context, true);
}

async function savePhoto(
  request: Request,
  context: { params: Promise<{ id: string }> },
  partial: boolean,
) {
  const started = performance.now();
  const requestId = randomUUID();
  const durations: { name: string; ms: number }[] = [];
  async function measure<T>(name: string, action: () => T | Promise<T>): Promise<T> {
    const start = performance.now();
    try { return await action(); }
    finally { durations.push({ name, ms: performance.now() - start }); }
  }
  const response = await apiAction(async () => {
    await measure("auth", () => requireAdministrator(request));
    const { id } = await context.params;
    const input = await measure("body", async () =>
      (partial ? photoPatchInput : photoInput).parse(await readJson(request)));
    return json(await measure("db", () => updatePhoto(id, input)));
  });
  durations.push({ name: "total", ms: performance.now() - started });
  const timing = durations.map(({ name, ms }) => `${name};dur=${ms.toFixed(2)}`).join(", ");
  response.headers.set("Server-Timing", timing);
  response.headers.set("X-Request-Id", requestId);
  // No photo fields, cookies or credentials are logged.
  if (response.status === 200 || performance.now() - started >= 1_000)
    console.log(`[照片保存] request=${requestId} status=${response.status} ${timing}`);
  return response;
}
