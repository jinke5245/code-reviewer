import { z } from "zod";

import { createGitLabReferenceContextClient } from "../../gitlab/reference-context.js";
import { readGitLabToolToken } from "./gitlab-utils.js";
import type { ToolImplementation } from "../types.js";

const inputSchema = z
  .object({
    projectId: z.string().min(1).optional(),
    state: z.enum(["opened", "closed", "merged", "locked", "all"]).optional(),
    search: z.string().min(1).optional(),
    limit: z.number().int().positive().max(100).default(100),
  })
  .strict();

export const listGitLabMrsTool: ToolImplementation = {
  inputSchema,
  execute(args, runtime) {
    const input = inputSchema.parse(args);
    const projectId = input.projectId ?? runtime.context.gitlab.projectId;
    const client = createGitLabReferenceContextClient({
      apiUrl: runtime.context.gitlab.apiUrl,
      token: readGitLabToolToken(runtime),
    });

    return client
      .listMergeRequests(projectId, {
        limit: input.limit,
        ...(input.search === undefined ? {} : { search: input.search }),
        ...(input.state === undefined ? {} : { state: input.state }),
      })
      .then((mergeRequests) => ({
        projectId,
        mergeRequests,
      }));
  },
};
