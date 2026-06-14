import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { loadReviewTemplates } from "../../src/gitlab/review-templates.js";

describe("loadReviewTemplates", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await rm(dir, { force: true, recursive: true });
      }),
    );
  });

  async function createTempCwd(): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-templates-"));
    tempDirs.push(cwd);
    return cwd;
  }

  it("returns no templates when none are configured", async () => {
    const cwd = await createTempCwd();

    await expect(
      loadReviewTemplates({
        config: {},
        cwd,
      }),
    ).resolves.toEqual({});
  });

  it("loads configured review templates from the repository", async () => {
    const cwd = await createTempCwd();
    const templateDir = join(cwd, ".codereviewer", "templates");

    await mkdir(templateDir, { recursive: true });
    await writeFile(
      join(templateDir, "summary.md"),
      "Summary: {{review.summary}}\n{{comment.fingerprint}}\n",
    );
    await writeFile(
      join(templateDir, "inline.md"),
      "Inline: {{finding.title}}\n{{comment.fingerprint}}\n",
    );

    await expect(
      loadReviewTemplates({
        config: {
          summary: ".codereviewer/templates/summary.md",
          inline: ".codereviewer/templates/inline.md",
        },
        cwd,
      }),
    ).resolves.toEqual({
      summary: "Summary: {{review.summary}}\n{{comment.fingerprint}}\n",
      inline: "Inline: {{finding.title}}\n{{comment.fingerprint}}\n",
    });
  });

  it("loads default review templates from the GitLab review template directory", async () => {
    const cwd = await createTempCwd();
    const templateDir = join(cwd, ".gitlab", "review_templates");

    await mkdir(templateDir, { recursive: true });
    await writeFile(
      join(templateDir, "SUMMARY.md"),
      "Default summary: {{review.summary}}\n",
    );
    await writeFile(
      join(templateDir, "Inline.md"),
      "Default inline: {{finding.title}}\n",
    );

    await expect(
      loadReviewTemplates({
        config: {},
        cwd,
      }),
    ).resolves.toEqual({
      summary: "Default summary: {{review.summary}}\n",
      inline: "Default inline: {{finding.title}}\n",
    });
  });

  it("prefers configured templates over default review templates", async () => {
    const cwd = await createTempCwd();
    const defaultTemplateDir = join(cwd, ".gitlab", "review_templates");
    const configuredTemplateDir = join(cwd, ".codereviewer", "templates");

    await mkdir(defaultTemplateDir, { recursive: true });
    await mkdir(configuredTemplateDir, { recursive: true });
    await writeFile(
      join(defaultTemplateDir, "summary.md"),
      "Default summary: {{review.summary}}\n",
    );
    await writeFile(
      join(defaultTemplateDir, "inline.md"),
      "Default inline: {{finding.title}}\n",
    );
    await writeFile(
      join(configuredTemplateDir, "summary.md"),
      "Configured summary: {{review.summary}}\n",
    );

    await expect(
      loadReviewTemplates({
        config: {
          summary: ".codereviewer/templates/summary.md",
        },
        cwd,
      }),
    ).resolves.toEqual({
      summary: "Configured summary: {{review.summary}}\n",
      inline: "Default inline: {{finding.title}}\n",
    });
  });
});
