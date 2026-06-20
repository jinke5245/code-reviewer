import { z } from "zod";

import type { ToolImplementation } from "../types.js";

const inputSchema = z
  .object({
    number: z.number().int().positive().optional(),
  })
  .strict();

export const readGitHubPrTool: ToolImplementation = {
  inputSchema,
  execute(args, runtime) {
    const input = inputSchema.parse(args);

    if (
      runtime.context.provider !== "github" ||
      runtime.context.platform.github === undefined
    ) {
      throw new Error("read_github_pr requires a GitHub pull request context");
    }

    if (
      input.number !== undefined &&
      input.number !== runtime.context.platform.github.pullNumber
    ) {
      throw new Error("read_github_pr only supports the current pull request");
    }

    return Promise.resolve({
      source: runtime.context.source,
      github: runtime.context.platform.github,
      pullRequest: runtime.context.pullRequest,
      changedFiles: runtime.context.changedFiles.map((file) => ({
        oldPath: file.oldPath,
        newPath: file.newPath,
        newFile: file.newFile,
        renamedFile: file.renamedFile,
        deletedFile: file.deletedFile,
      })),
    });
  },
};
