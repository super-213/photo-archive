import { developmentAdminEmail, getAuth } from "@/lib/server/auth";
import { apiAction, json } from "@/lib/server/http";

export const runtime = "nodejs";
async function handle(request: Request) {
  return apiAction(async () => {
    const endpoint = new URL(request.url).pathname.replace("/api/auth/", "");
    if (!["sign-in/email", "sign-out", "get-session"].includes(endpoint))
      return json({ error: "此认证接口未启用" }, 404);
    if (
      process.env.NODE_ENV === "development" &&
      request.method === "POST" &&
      endpoint === "sign-in/email"
    ) {
      const body = await request.json();
      if (body?.email === "admin") body.email = developmentAdminEmail;
      request = new Request(request, { body: JSON.stringify(body) });
    }
    const response = await (await getAuth()).handler(request);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  });
}
export { handle as GET, handle as POST };
