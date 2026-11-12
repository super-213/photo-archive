import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, copyFile, symlink, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const project = fileURLToPath(new URL("../", import.meta.url));

async function createFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "photo-archive-script-test-"));
  await mkdir(path.join(directory, "scripts"));
  for (const filename of ["environment.mjs", "service.mjs"])
    await copyFile(path.join(project, "scripts", filename), path.join(directory, "scripts", filename));
  await symlink(path.join(project, "node_modules"), path.join(directory, "node_modules"));
  await writeFile(path.join(directory, "package.json"), '{"type":"module"}\n');
  return directory;
}

test("deployment configuration preserves existing values, special-character credentials and file permissions", async () => {
  const directory = await createFixture();
  try {
    const filename = path.join(directory, ".env.local");
    await writeFile(filename, '# domain configuration\nBETTER_AUTH_URL="https://photos.example.com"\nPHOTO_ARCHIVE_PORT=3000\nPHOTO_ARCHIVE_PORT=3001\nPHOTO_ARCHIVE_ADMIN_PASSWORD="old-password"\n');
    const password = "quotes'\"$\\and-a-long-password";
    const values = {
      PHOTO_ARCHIVE_ADMIN_EMAIL: "owner@example.com",
      PHOTO_ARCHIVE_ADMIN_PASSWORD: null,
      PHOTO_ARCHIVE_ADMIN_PASSWORD_BASE64: Buffer.from(password).toString("base64"),
      PHOTO_ARCHIVE_PORT: "55647",
    };
    await execute(process.execPath, ["--input-type=module", "-e", `
      const { saveEnvironment } = await import('./scripts/environment.mjs');
      saveEnvironment(${JSON.stringify(values)});
    `], { cwd: directory });
    const contents = await readFile(filename, "utf8");
    assert.ok(contents.includes('# domain configuration\nBETTER_AUTH_URL="https://photos.example.com"'));
    assert.equal((contents.match(/^PHOTO_ARCHIVE_PORT=/gm) || []).length, 1);
    assert.doesNotMatch(contents, /^PHOTO_ARCHIVE_ADMIN_PASSWORD=/m);
    assert.equal((await stat(filename)).mode & 0o777, 0o600);
    const { stdout } = await execute(process.execPath, ["--input-type=module", "-e", `
      await import('./scripts/environment.mjs');
      console.log(JSON.stringify({
        port: process.env.PHOTO_ARCHIVE_PORT,
        password: Buffer.from(process.env.PHOTO_ARCHIVE_ADMIN_PASSWORD_BASE64, 'base64').toString(),
        url: process.env.BETTER_AUTH_URL
      }));
    `], { cwd: directory });
    assert.deepEqual(JSON.parse(stdout), {
      port: "55647",
      password,
      url: "https://photos.example.com",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("deployment commands handle a fresh checkout and require a saved port before restarting", async () => {
  const directory = await createFixture();
  const env = { ...process.env };
  delete env.PHOTO_ARCHIVE_PORT;
  try {
    for (const action of ["status", "stop", "stop"]) {
      const { stdout } = await execute(process.execPath, ["scripts/service.mjs", action], {
        cwd: directory,
        env,
      });
      assert.match(stdout, /服务已停止/);
    }
    await assert.rejects(
      execute(process.execPath, ["scripts/service.mjs", "restart"], { cwd: directory, env }),
      (error: unknown) => {
        assert.match((error as { stderr: string }).stderr, /尚未保存部署端口/);
        return true;
      },
    );
    await assert.rejects(stat(path.join(directory, ".runtime/control.lock")), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
