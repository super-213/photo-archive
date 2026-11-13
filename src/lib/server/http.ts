import "server-only";
import { ZodError } from "zod";
import { getAdministrator } from "./auth";
import { AppError } from "./validation";
import { getRequestOrigin } from "./origins";
import { recordServerError } from "./monitoring";

export function requireSameOrigin(request: Request) {
  if (request.headers.get("origin") !== getRequestOrigin(request))
    throw new AppError("请求来源校验失败，请从站点管理页面操作", 403);
}

export async function requireAdministrator(request: Request) {
  const user = await getAdministrator(request.headers);
  if (!user) throw new AppError("请先登录管理员账号", 401);
  if (!["GET", "HEAD"].includes(request.method)) requireSameOrigin(request);
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
    console.error("API operation failed", error);
    if (process.env.NODE_ENV === "production") recordServerError(error, "/api/[route]");
    return json({ error: "操作失败，请稍后重试并检查服务日志" }, 500);
  }
}

export async function readBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit)
    throw new AppError("请求数据超过大小限制", 413);
  if (!request.body) throw new AppError("请求数据不能为空");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new AppError("请求数据超过大小限制", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export async function readJson(request: Request) {
  const buffer = await readBody(request, 4 * 1024 * 1024);
  return JSON.parse(buffer.toString("utf8"));
}
