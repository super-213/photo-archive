import "./environment.mjs";
import { setTimeout } from "node:timers/promises";
import { createFolderImporter, getFolderImportStatus } from "../src/lib/server/folder-import";
import { getDatabase } from "../src/lib/server/database";

try {
  const importer = createFolderImporter();
  if (process.argv.includes("--retry")) {
    getDatabase().prepare("UPDATE folder_import SET status='waiting',observed_at=? WHERE status='error'").run(Date.now());
  }
  await importer.scan();
  await setTimeout(6_000);
  await importer.scan();
  const status = getFolderImportStatus(importer.directory);
  console.log(JSON.stringify(status, null, 2));
  if (status.counts.error) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  getDatabase().close();
}
