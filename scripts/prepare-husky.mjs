import { access, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";

const skipCommands = new Set(["pack", "publish"]);
const npmCommand = process.env.npm_command;

if (
  process.env.CI === "true" ||
  process.env.HUSKY === "0" ||
  skipCommands.has(npmCommand ?? "")
) {
  process.exit(0);
}

try {
  await access(".git", constants.F_OK);
  await writeFile(".git/config.lock", "");
  await rm(".git/config.lock", { force: true });
} catch {
  process.exit(0);
}

const result = spawnSync("husky", {
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
