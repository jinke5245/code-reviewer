import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { resolveRepositoryRealPath } from "../repository-path.js";
import type { ToolImplementation } from "../types.js";

const maxSearchFileBytes = 1024 * 1024;

const inputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(1000).default(100),
  maxFiles: z.number().int().positive().max(10000).default(5000),
});

export const repoSearchTool: ToolImplementation = {
  inputSchema,
  async execute(args, runtime) {
    const { limit, maxFiles, query } = inputSchema.parse(args);
    const result = await searchRepository(runtime.cwd, query, {
      limit,
      maxFiles,
    });

    return {
      query,
      ...result,
    };
  },
};

type RepositorySearchOptions = {
  limit: number;
  maxFiles: number;
};

type RepositorySearchResult = {
  matches: Array<{ path: string; line: number; text: string }>;
  searchedFiles: number;
  truncated: boolean;
};

type SearchableRepositoryFile = {
  path: string;
  filePath: string;
};

async function searchRepository(
  cwd: string,
  query: string,
  { limit, maxFiles }: RepositorySearchOptions,
): Promise<RepositorySearchResult> {
  const listedFiles = await listSearchableRepositoryFiles(cwd, maxFiles);
  const matches: Array<{ path: string; line: number; text: string }> = [];
  let searchedFiles = 0;
  let truncated = listedFiles.truncated;

  for (const { filePath, path } of listedFiles.files) {
    if (matches.length >= limit) {
      truncated = true;
      break;
    }

    if (!(await isSearchableRepositoryFile(filePath))) {
      continue;
    }

    const content = await readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/u);
    searchedFiles += 1;

    for (const [index, line] of lines.entries()) {
      if (line.includes(query)) {
        matches.push({
          path,
          line: index + 1,
          text: line,
        });

        if (matches.length >= limit) {
          truncated = true;
          break;
        }
      }
    }
  }

  return {
    matches: matches.sort((left, right) =>
      left.path === right.path
        ? left.line - right.line
        : left.path.localeCompare(right.path),
    ),
    searchedFiles,
    truncated,
  };
}

export async function listSearchableRepositoryFiles(
  cwd: string,
  maxFiles: number,
): Promise<{ files: SearchableRepositoryFile[]; truncated: boolean }> {
  const textFiles: SearchableRepositoryFile[] = [];
  let truncated = false;
  const ignoredDirectories = new Set([
    ".git",
    ".pnpm-store",
    "coverage",
    "dist",
    "node_modules",
    "public",
  ]);

  async function visit(relativeDirectory: string): Promise<void> {
    if (truncated) {
      return;
    }

    const absoluteDirectory =
      relativeDirectory.length === 0
        ? resolve(cwd)
        : await resolveRepositoryRealPath(cwd, relativeDirectory);
    const entries = await readdir(absoluteDirectory, {
      withFileTypes: true,
    });

    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const relativePath =
        relativeDirectory.length === 0
          ? entry.name
          : `${relativeDirectory}/${entry.name}`;

      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          await visit(relativePath);
        }

        continue;
      }

      if (entry.isFile()) {
        const filePath = await resolveRepositoryRealPath(cwd, relativePath);

        if (!(await isSearchableRepositoryFile(filePath))) {
          continue;
        }

        if (textFiles.length >= maxFiles) {
          truncated = true;
          break;
        }

        textFiles.push({
          path: relativePath,
          filePath,
        });
      }
    }
  }

  await visit("");

  return {
    files: textFiles.sort((left, right) => left.path.localeCompare(right.path)),
    truncated,
  };
}

/** Returns whether the current file state is safe for repository search. */
export async function isSearchableRepositoryFile(
  filePath: string,
): Promise<boolean> {
  const fileStat = await stat(filePath);

  return fileStat.isFile() && fileStat.size <= maxSearchFileBytes;
}
