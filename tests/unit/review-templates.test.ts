import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { loadReviewTemplates } from "../../src/review/review-templates.js";

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
        provider: "gitlab",
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
        provider: "github",
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
        provider: "gitlab",
      }),
    ).resolves.toEqual({
      summary: "Default summary: {{review.summary}}\n",
      inline: "Default inline: {{finding.title}}\n",
    });
  });

  it("loads default review templates from the current provider directory first", async () => {
    const cwd = await createTempCwd();
    const githubTemplateDir = join(cwd, ".github", "REVIEW_TEMPLATES");
    const gitlabTemplateDir = join(cwd, ".gitlab", "review_templates");

    await mkdir(githubTemplateDir, { recursive: true });
    await mkdir(gitlabTemplateDir, { recursive: true });
    await writeFile(
      join(githubTemplateDir, "summary.md"),
      "GitHub summary: {{review.summary}}\n",
    );
    await writeFile(
      join(gitlabTemplateDir, "summary.md"),
      "GitLab summary: {{review.summary}}\n",
    );

    await expect(
      loadReviewTemplates({
        config: {},
        cwd,
        provider: "github",
      }),
    ).resolves.toEqual({
      summary: "GitHub summary: {{review.summary}}\n",
    });
  });

  it("falls back to the other provider template directory when the current provider has none", async () => {
    const cwd = await createTempCwd();
    const templateDir = join(cwd, ".gitlab", "review_template");

    await mkdir(templateDir, { recursive: true });
    await writeFile(
      join(templateDir, "summary.md"),
      "Fallback summary: {{review.summary}}\n",
    );

    await expect(
      loadReviewTemplates({
        config: {},
        cwd,
        provider: "github",
      }),
    ).resolves.toEqual({
      summary: "Fallback summary: {{review.summary}}\n",
    });
  });

  it("supports review template directory aliases", async () => {
    const cwd = await createTempCwd();
    const summaryTemplateDir = join(cwd, ".github", "REVIEW_TEMPLATE");
    const inlineTemplateDir = join(cwd, ".github", "review_template");

    await mkdir(summaryTemplateDir, { recursive: true });
    await mkdir(inlineTemplateDir, { recursive: true });
    await writeFile(
      join(summaryTemplateDir, "summary.md"),
      "Alias summary: {{review.summary}}\n",
    );
    await writeFile(
      join(inlineTemplateDir, "inline.md"),
      "Alias inline: {{finding.title}}\n",
    );

    await expect(
      loadReviewTemplates({
        config: {},
        cwd,
        provider: "github",
      }),
    ).resolves.toEqual({
      summary: "Alias summary: {{review.summary}}\n",
      inline: "Alias inline: {{finding.title}}\n",
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
        provider: "gitlab",
      }),
    ).resolves.toEqual({
      summary: "Configured summary: {{review.summary}}\n",
      inline: "Default inline: {{finding.title}}\n",
    });
  });
});
