import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

interface NpmPackageTree {
  dependencies?: Record<
    string,
    {
      dependencies?: Record<string, unknown>;
    }
  >;
}

describe("package bundle", () => {
  it("installs and runs the packaged CLI without production dependencies", async () => {
    await execFileAsync("pnpm", ["bundle"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    const packRoot = await mkdtemp(join(tmpdir(), "codereviewer-pack-"));
    const { stdout: packOutput } = await execFileAsync(
      "pnpm",
      ["pack", "--pack-destination", packRoot],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );
    const packageArchive = packOutput.trim().split(/\r?\n/).at(-1);
    expect(packageArchive).toBeTruthy();

    const consumerRoot = await mkdtemp(join(tmpdir(), "codereviewer-consumer-"));
    const npmCache = await mkdtemp(join(tmpdir(), "codereviewer-npm-cache-"));
    await writeFile(
      join(consumerRoot, "package.json"),
      JSON.stringify({ private: true }, null, 2),
    );

    await execFileAsync(
      "npm",
      [
        "install",
        "--offline",
        "--cache",
        npmCache,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        packageArchive ?? "",
      ],
      {
        cwd: consumerRoot,
        encoding: "utf8",
      },
    );

    const { stdout } = await execFileAsync(
      join(consumerRoot, "node_modules", ".bin", "codereviewer"),
      ["--version"],
      {
        cwd: consumerRoot,
        encoding: "utf8",
      },
    );

    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);

    const { stdout: dependencyTreeOutput } = await execFileAsync(
      "npm",
      ["ls", "--omit=dev", "--all", "--json"],
      {
        cwd: consumerRoot,
        encoding: "utf8",
      },
    );
    const dependencyTree = JSON.parse(dependencyTreeOutput) as NpmPackageTree;
    expect(
      dependencyTree.dependencies?.["@jinke5245/code-reviewer"]?.dependencies ??
        {},
    ).toEqual({});
  });
});
