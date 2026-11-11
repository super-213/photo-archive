import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createAuth, getAuth } from "../src/lib/server/auth";
import { getDatabase } from "../src/lib/server/database";

async function readPassword() {
  if (!stdin.isTTY)
    throw new Error(
      "请在交互式终端运行，或通过 PHOTO_ARCHIVE_ADMIN_PASSWORD 环境变量提供密码",
    );
  stdout.write("管理员密码（至少 12 位，输入隐藏） ");
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
  await getAuth();
  const db = getDatabase();
  if (db.prepare("SELECT 1 FROM administrator LIMIT 1").get())
    throw new Error("管理员账号已存在");
  let email = process.env.PHOTO_ARCHIVE_ADMIN_EMAIL;
  if (!email) {
    const prompt = createInterface({ input: stdin, output: stdout });
    email = (await prompt.question("管理员邮箱 ")).trim();
    prompt.close();
  }
  const password =
    process.env.PHOTO_ARCHIVE_ADMIN_PASSWORD || (await readPassword());
  const setup = createAuth(true);
  const result = await setup.api.signUpEmail({
    body: { email, password, name: "站点管理员" },
  });
  db.prepare("INSERT INTO administrator(user_id) VALUES (?)").run(
    result.user.id,
  );
  console.log("管理员已创建，可前往 /admin 登录。");
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "创建失败");
  process.exitCode = 1;
});
