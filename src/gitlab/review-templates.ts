import { readdir, readFile } from "node:fs/promises";

import type { CodeReviewerConfig } from "../config/schema.js";
import { formatErrorMessage } from "../tools/format-error.js";
import { resolveRepositoryRealPath } from "../tools/repository-path.js";

const defaultReviewTemplateDirectory = ".gitlab/review_templates";

const defaultReviewTemplateFilenames = {
  inline: "inline.md",
  summary: "summary.md",
} as const;

/** Markdown templates loaded for GitLab review publication. */
export type LoadedReviewTemplates = {
  summary?: string;
  inline?: string;
};

/** Options for loading review publication templates from repository files. */
export type LoadReviewTemplatesOptions = {
  config: CodeReviewerConfig["templates"];
  cwd: string;
};

/** Loads configured Markdown templates for GitLab review publication. */
export async function loadReviewTemplates({
  config,
  cwd,
}: LoadReviewTemplatesOptions): Promise<LoadedReviewTemplates> {
  const templates: LoadedReviewTemplates = {};

  if (config.summary !== undefined) {
    templates.summary = await readTemplateFile(cwd, config.summary, "summary");
  } else {
    const defaultSummaryTemplate = await readDefaultTemplateFile(
      cwd,
      "summary",
    );

    if (defaultSummaryTemplate !== undefined) {
      templates.summary = defaultSummaryTemplate;
    }
  }

  if (config.inline !== undefined) {
    templates.inline = await readTemplateFile(cwd, config.inline, "inline");
  } else {
    const defaultInlineTemplate = await readDefaultTemplateFile(cwd, "inline");

    if (defaultInlineTemplate !== undefined) {
      templates.inline = defaultInlineTemplate;
    }
  }

  return templates;
}

async function readDefaultTemplateFile(
  cwd: string,
  templateName: "summary" | "inline",
): Promise<string | undefined> {
  const path = await findDefaultTemplatePath(cwd, templateName);

  if (path === undefined) {
    return undefined;
  }

  return await readTemplateFile(cwd, path, templateName);
}

async function findDefaultTemplatePath(
  cwd: string,
  templateName: "summary" | "inline",
): Promise<string | undefined> {
  const expectedFilename = defaultReviewTemplateFilenames[templateName];

  try {
    const resolvedDirectory = await resolveRepositoryRealPath(
      cwd,
      defaultReviewTemplateDirectory,
    );
    const entries = await readdir(resolvedDirectory, { withFileTypes: true });
    const matchingNames = entries
      .map((entry) => entry.name)
      .filter((name) => name.toLowerCase() === expectedFilename);

    const selectedName =
      matchingNames.find((name) => name === expectedFilename) ??
      matchingNames.toSorted()[0];

    return selectedName === undefined
      ? undefined
      : `${defaultReviewTemplateDirectory}/${selectedName}`;
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }

    throw new Error(
      `Cannot read default review template directory ${defaultReviewTemplateDirectory}: ${formatErrorMessage(error)}`,
      {
        cause: error,
      },
    );
  }
}

async function readTemplateFile(
  cwd: string,
  path: string,
  templateName: "summary" | "inline",
): Promise<string> {
  try {
    const resolvedPath = await resolveRepositoryRealPath(cwd, path);

    return await readFile(resolvedPath, "utf8");
  } catch (error) {
    throw new Error(
      `Cannot read ${templateName} template file ${path}: ${formatErrorMessage(error)}`,
      {
        cause: error,
      },
    );
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
