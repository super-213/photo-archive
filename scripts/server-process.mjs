import { nextStart } from "next/dist/cli/next-start.js";

const [port, instance] = process.argv.slice(2);
let ready = false;
process.once("disconnect", () => {
  if (!ready) process.kill(process.pid, "SIGTERM");
});
try {
  await nextStart({ hostname: "0.0.0.0", port: Number(port) }, process.cwd());
  process.title = `photo-archive:${instance}`;
  ready = true;
  process.send?.({ ready: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
