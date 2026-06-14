import { z } from "zod";

import { parseGitLabDiffLines } from "../../gitlab/diff-lines.js";
import { assertRepositoryRelativePath } from "../repository-path.js";
import type { ToolImplementation } from "../types.js";

const inputSchema = z.object({
  path: z.string().min(1),
});

export const readDiffTool: ToolImplementation = {
  inputSchema,
  execute(args, runtime) {
    const { path } = inputSchema.parse(args);
    assertRepositoryRelativePath(path);

    const changedFile = runtime.context.changedFiles.find(
      (file) => file.newPath === path || file.oldPath === path,
    );

    if (changedFile === undefined) {
      throw new Error(`No changed file diff found for path: ${path}`);
    }

    return Promise.resolve({
      path,
      oldPath: changedFile.oldPath,
      newPath: changedFile.newPath,
      diff: changedFile.diff,
      lines: parseGitLabDiffLines(changedFile.diff),
    });
  },
};
