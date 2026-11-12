import "server-only";
import { networkInterfaces } from "node:os";
import { AppError } from "./validation";

function localHosts() {
  const hosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  for (const addresses of Object.values(networkInterfaces())) {
    for (const { address, family } of addresses || []) {
      if (family !== "IPv4") continue;
      const [first, second] = address.split(".").map(Number);
      if (first === 10 || (first === 172 && second >= 16 && second <= 31) ||
          (first === 192 && second === 168)) hosts.add(address);
    }
  }
  return hosts;
}

// Resolve from Host, never Origin or forwarded headers supplied by a client.
// Only the configured public host and this machine's own LAN addresses qualify.
export function getRequestOrigin(source: Headers | Request) {
  const headers = source instanceof Request ? source.headers : source;
  const configured = process.env.BETTER_AUTH_URL
    ? new URL(process.env.BETTER_AUTH_URL)
    : undefined;
  const host = headers.get("host") || (source instanceof Request ? new URL(source.url).host : "");
  if (!host) return configured?.origin || "http://localhost";
  let url: URL;
  try {
    url = new URL(`http://${host}`);
  } catch {
    throw new AppError("此访问地址未启用后台登录", 403);
  }
  if (url.host !== host.toLowerCase() || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash)
    throw new AppError("此访问地址未启用后台登录", 403);
  if (configured?.host === url.host) return configured.origin;
  if (localHosts().has(url.hostname)) return url.origin;
  throw new AppError("此访问地址未启用后台登录", 403);
}
