import { createRequire } from "node:module";
import { readFileSync, writeFileSync, renameSync, chmodSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
export const environmentFile = path.join(projectDirectory, ".env.local");
const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(projectDirectory, false);

export function saveEnvironment(values) {
  let contents = "";
  try {
    contents = readFileSync(environmentFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || (value !== null && /[\r\n"]/.test(value)))
      throw new Error("环境配置包含不支持的字符");
    const pattern = new RegExp(`^(?:export\\s+)?${key}\\s*=.*$`, "gm");
    contents = contents.replace(pattern, "");
    if (value !== null) {
      const line = `${key}="${value.replaceAll("$", "\\$")}"`;
      contents = `${contents.trimEnd()}\n${line}\n`;
    }
  }
  const temporaryFile = `${environmentFile}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryFile, contents.replace(/^\n/, ""), { mode: 0o600 });
    renameSync(temporaryFile, environmentFile);
  } finally {
    rmSync(temporaryFile, { force: true });
  }
  chmodSync(environmentFile, 0o600);
  for (const [key, value] of Object.entries(values)) {
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
}

export function saveAdministratorEnvironment(email) {
  saveEnvironment({
    PHOTO_ARCHIVE_ADMIN_EMAIL: email,
    PHOTO_ARCHIVE_ADMIN_PASSWORD: null,
    PHOTO_ARCHIVE_ADMIN_PASSWORD_BASE64: null,
  });
}
