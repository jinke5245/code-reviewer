import { readdir, readFile } from "node:fs/promises";

import type { CodeReviewerConfig } from "../config/schema.js";
import type { ReviewProviderName } from "../platform/types.js";
import { formatErrorMessage } from "../tools/format-error.js";
import { resolveRepositoryRealPath } from "../tools/repository-path.js";

const reviewTemplatePlatformDirectories: Record<ReviewProviderName, string> = {
  github: ".github",
  gitlab: ".gitlab",
};

const reviewTemplateDirectoryNames = [
  "review_templates",
  "review_template",
  "REVIEW_TEMPLATES",
  "REVIEW_TEMPLATE",
] as const;

const defaultReviewTemplateFilenames = {
  inline: "inline.md",
  summary: "summary.md",
} as const;

/** Markdown templates loaded for review publication. */
export type LoadedReviewTemplates = {
  summary?: string;
  inline?: string;
};

/** Options for loading review publication templates from repository files. */
export type LoadReviewTemplatesOptions = {
  config: CodeReviewerConfig["templates"];
  cwd: string;
  provider?: ReviewProviderName;
};

/** Loads configured Markdown templates for review publication. */
export async function loadReviewTemplates({
  config,
  cwd,
  provider = "gitlab",
}: LoadReviewTemplatesOptions): Promise<LoadedReviewTemplates> {
  const templates: LoadedReviewTemplates = {};

  if (config.summary !== undefined) {
    templates.summary = await readTemplateFile(cwd, config.summary, "summary");
  } else {
    const defaultSummaryTemplate = await readDefaultTemplateFile(
      cwd,
      provider,
      "summary",
    );

    if (defaultSummaryTemplate !== undefined) {
      templates.summary = defaultSummaryTemplate;
    }
  }

  if (config.inline !== undefined) {
    templates.inline = await readTemplateFile(cwd, config.inline, "inline");
  } else {
    const defaultInlineTemplate = await readDefaultTemplateFile(
      cwd,
      provider,
      "inline",
    );

    if (defaultInlineTemplate !== undefined) {
      templates.inline = defaultInlineTemplate;
    }
  }

  return templates;
}

async function readDefaultTemplateFile(
  cwd: string,
  provider: ReviewProviderName,
  templateName: "summary" | "inline",
): Promise<string | undefined> {
  const path = await findDefaultTemplatePath(cwd, provider, templateName);

  if (path === undefined) {
    return undefined;
  }

  return await readTemplateFile(cwd, path, templateName);
}

async function findDefaultTemplatePath(
  cwd: string,
  provider: ReviewProviderName,
  templateName: "summary" | "inline",
): Promise<string | undefined> {
  for (const platform of getDefaultTemplatePlatformOrder(provider)) {
    for (const directoryName of reviewTemplateDirectoryNames) {
      const directory = `${reviewTemplatePlatformDirectories[platform]}/${directoryName}`;
      const path = await findTemplatePathInDirectory(
        cwd,
        directory,
        templateName,
      );

      if (path !== undefined) {
        return path;
      }
    }
  }

  return undefined;
}

async function findTemplatePathInDirectory(
  cwd: string,
  directory: string,
  templateName: "summary" | "inline",
): Promise<string | undefined> {
  const expectedFilename = defaultReviewTemplateFilenames[templateName];

  try {
    const resolvedDirectory = await resolveRepositoryRealPath(cwd, directory);
    const entries = await readdir(resolvedDirectory, { withFileTypes: true });
    const matchingNames = entries
      .map((entry) => entry.name)
      .filter((name) => name.toLowerCase() === expectedFilename);

    const selectedName =
      matchingNames.find((name) => name === expectedFilename) ??
      matchingNames.toSorted()[0];

    return selectedName === undefined
      ? undefined
      : `${directory}/${selectedName}`;
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }

    throw new Error(
      `Cannot read default review template directory ${directory}: ${formatErrorMessage(error)}`,
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

function getDefaultTemplatePlatformOrder(
  provider: ReviewProviderName,
): ReviewProviderName[] {
  return provider === "github" ? ["github", "gitlab"] : ["gitlab", "github"];
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
