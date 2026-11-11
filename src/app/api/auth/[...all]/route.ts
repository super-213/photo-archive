import { getAuth } from "@/lib/server/auth";
import { apiAction, json } from "@/lib/server/http";

export const runtime = "nodejs";
async function handle(request: Request) {
  return apiAction(async () => {
    const endpoint = new URL(request.url).pathname.replace("/api/auth/", "");
    if (!["sign-in/email", "sign-out", "get-session"].includes(endpoint))
      return json({ error: "此认证接口未启用" }, 404);
    const response = await (await getAuth()).handler(request);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  });
}
export { handle as GET, handle as POST };
