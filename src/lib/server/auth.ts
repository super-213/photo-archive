import "server-only";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDatabase, dataDirectory } from "./database";

function getSecret() {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  getDatabase();
  const filename = path.join(dataDirectory, "auth-secret");
  try {
    writeFileSync(filename, randomBytes(48).toString("base64url"), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return readFileSync(filename, "utf8").trim();
}

export function createAuth(allowSetup = false) {
  return betterAuth({
    appName: "Photo Archive",
    database: getDatabase(),
    secret: getSecret(),
    baseURL:
      process.env.BETTER_AUTH_URL ||
      (allowSetup
        ? "http://localhost"
        : { allowedHosts: ["localhost:*", "127.0.0.1:*"], protocol: "http" }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !allowSetup,
      minPasswordLength: 12,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 12,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 20,
      storage: "database",
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
    },
    advanced: { cookiePrefix: "photo-archive" },
  });
}

let instance: ReturnType<typeof createAuth> | undefined;
let initialized: Promise<void> | undefined;
export async function getAuth() {
  instance ??= createAuth();
  initialized ??= getMigrations(instance.options)
    .then(({ runMigrations }) => runMigrations())
    .catch((error) => {
      initialized = undefined;
      throw error;
    });
  await initialized;
  return instance;
}

export async function getAdministrator(headers: Headers) {
  if (!headers.get("cookie")) return null;
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers });
  if (
    !session ||
    !getDatabase()
      .prepare("SELECT 1 FROM administrator WHERE user_id=?")
      .get(session.user.id)
  )
    return null;
  return session.user;
}
