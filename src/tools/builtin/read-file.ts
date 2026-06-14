import { readFile, stat } from "node:fs/promises";

import { z } from "zod";

import { formatErrorMessage } from "../format-error.js";
import { resolveRepositoryRealPath } from "../repository-path.js";
import type { ToolImplementation } from "../types.js";

const inputSchema = z.object({
  path: z.string().min(1),
});

class RepositoryFileTooLargeError extends Error {
  constructor(path: string, fileBytes: number, maxBytes: number) {
    super(
      `Repository file exceeds maxBytesPerToolResult: ${path} is ${String(fileBytes)} bytes > ${String(maxBytes)}`,
    );
  }
}

export const readFileTool: ToolImplementation = {
  inputSchema,
  async execute(args, runtime) {
    const { path } = inputSchema.parse(args);

    try {
      const filePath = await resolveRepositoryRealPath(runtime.cwd, path);
      const fileStat = await stat(filePath);

      if (fileStat.size > runtime.limits.maxBytesPerToolResult) {
        throw new RepositoryFileTooLargeError(
          path,
          fileStat.size,
          runtime.limits.maxBytesPerToolResult,
        );
      }

      const content = await readFile(filePath, "utf8");

      return {
        path,
        content,
        lines: toNumberedLines(content),
      };
    } catch (error) {
      if (error instanceof RepositoryFileTooLargeError) {
        throw error;
      }

      throw new Error(
        `Cannot read repository file ${path}: ${formatErrorMessage(error)}`,
        {
          cause: error,
        },
      );
    }
  },
};

function toNumberedLines(content: string): Array<{ line: number; text: string }> {
  const body = content.endsWith("\n")
    ? content.replace(/\r?\n$/u, "")
    : content;

  if (body.length === 0) {
    return [];
  }

  return body.split(/\r?\n/u).map((text, index) => ({
    line: index + 1,
    text,
  }));
}
