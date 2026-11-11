import "server-only";
import { ZodError } from "zod";
import { getAdministrator } from "./auth";
import { AppError } from "./validation";

export async function requireAdministrator(request: Request) {
  const user = await getAdministrator(request.headers);
  if (!user) throw new AppError("请先登录管理员账号", 401);
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host") || new URL(request.url).host;
    const expected = process.env.BETTER_AUTH_URL
      ? new URL(process.env.BETTER_AUTH_URL).origin
      : /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
        ? `http://${host}`
        : "";
    if (origin !== expected)
      throw new AppError("请求来源校验失败，请从站点管理页面操作", 403);
  }
  return user;
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export async function apiAction(action: () => Promise<Response> | Response) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof AppError)
      return json({ error: error.message }, error.status);
    if (error instanceof ZodError)
      return json(
        {
          error: error.issues
            .map((issue) => `${issue.path.join(".")} ${issue.message}`)
            .join("；"),
        },
        400,
      );
    if (error instanceof SyntaxError)
      return json({ error: "请求数据格式无效" }, 400);
    console.error("Admin operation failed", error);
    return json({ error: "操作失败，请稍后重试并检查服务日志" }, 500);
  }
}
