import { saveAdministratorEnvironment } from "./environment.mjs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { z } from "zod";
import { createAuth, getAuth } from "../src/lib/server/auth";
import { getDatabase } from "../src/lib/server/database";

async function readPassword(label = "管理员密码（至少 12 位，输入隐藏） ") {
  if (!stdin.isTTY)
    throw new Error(
      "请在交互式终端运行，或通过 PHOTO_ARCHIVE_ADMIN_PASSWORD 环境变量提供密码",
    );
  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let password = "";
    function finish() {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    }
    function onData(chunk: Buffer) {
      for (const character of chunk.toString()) {
        if (character === "\u0003") {
          finish();
          reject(new Error("已取消"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          resolve(password);
          return;
        }
        if (character === "\u007f" || character === "\b")
          password = password.slice(0, -1);
        else if (character >= " ") password += character;
      }
    }
    stdin.on("data", onData);
  });
}

async function main() {
  const ensure = process.argv.includes("--ensure");
  const save = process.argv.includes("--save-env");
  await getAuth();
  const db = getDatabase();
  const existing = db.prepare(
    'SELECT "user".email FROM administrator JOIN "user" ON "user".id = administrator.user_id LIMIT 1',
  ).get() as { email: string } | undefined;
  if (existing) {
    if (ensure) {
      if (save) saveAdministratorEnvironment(existing.email);
      console.log("管理员账号已存在。");
      return;
    }
    throw new Error("管理员账号已存在");
  }
  if (save && !stdin.isTTY)
    throw new Error("首次部署请在交互式终端中运行 ./start.sh，以创建管理员账号");
  let email = process.env.PHOTO_ARCHIVE_ADMIN_EMAIL;
  if (!email || save) {
    const prompt = createInterface({ input: stdin, output: stdout });
    try {
      do {
        const previous = process.env.PHOTO_ARCHIVE_ADMIN_EMAIL;
        email = (await prompt.question(`管理员邮箱${previous ? ` [${previous}]` : ""} `)).trim() || previous;
        if (z.email().safeParse(email).success) break;
        console.log("请输入有效的邮箱地址。");
      } while (true);
    } finally {
      prompt.close();
    }
  }
  let password = process.env.PHOTO_ARCHIVE_ADMIN_PASSWORD;
  if (!password && process.env.PHOTO_ARCHIVE_ADMIN_PASSWORD_BASE64)
    password = Buffer.from(process.env.PHOTO_ARCHIVE_ADMIN_PASSWORD_BASE64, "base64").toString("utf8");
  if (!password || save) {
    do {
      password = await readPassword();
      if (password.length < 12) {
        console.log("密码至少需要 12 位，请重新输入。");
        continue;
      }
      if (!save || password === await readPassword("再次输入管理员密码 ")) break;
      console.log("两次密码不一致，请重新输入。");
    } while (true);
  }
  const validatedEmail = z.email().parse(email);
  const setup = createAuth(true);
  const result = await setup.api.signUpEmail({
    body: { email: validatedEmail, password, name: "站点管理员" },
  });
  db.prepare("INSERT INTO administrator(user_id) VALUES (?)").run(
    result.user.id,
  );
  if (save) {
    saveAdministratorEnvironment(validatedEmail);
    console.log("管理员邮箱已保存到 .env.local（权限 600），密码哈希已存入数据库。");
  }
  console.log("管理员已创建，可前往 /admin 登录。");
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "创建失败");
  process.exitCode = 1;
});
