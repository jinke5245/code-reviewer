import { z } from "zod";

import {
  createGitLabReferenceContextClient,
  parseGitLabReference,
} from "../../gitlab/reference-context.js";
import {
  assertUnambiguousGitLabTarget,
  readGitLabToolContext,
  readGitLabToolToken,
} from "./gitlab-utils.js";
import type { GitLabMergeRequestContext } from "../../gitlab/mr-context.js";
import type { ToolImplementation } from "../types.js";

const inputSchema = z
  .object({
    iid: z.number().int().positive().optional(),
    projectId: z.string().min(1).optional(),
    reference: z.string().min(1).optional(),
  })
  .strict();

export const readGitLabMrTool: ToolImplementation = {
  inputSchema,
  execute(args, runtime) {
    const input = inputSchema.parse(args);
    assertUnambiguousGitLabTarget(input);
    const context = readGitLabToolContext(runtime);

    if (
      input.iid !== undefined ||
      input.projectId !== undefined ||
      input.reference !== undefined
    ) {
      const target =
        input.reference === undefined
          ? {
              projectId: input.projectId ?? context.gitlab.projectId,
              iid: readRequiredIid(input.iid),
            }
          : resolveMergeRequestReference(input.reference, context);
      const client = createGitLabReferenceContextClient({
        apiUrl: context.gitlab.apiUrl,
        token: readGitLabToolToken(runtime),
      });

      return client.getMergeRequest(target.projectId, target.iid);
    }

    return Promise.resolve({
      source: context.source,
      gitlab: context.gitlab,
      mergeRequest: context.mergeRequest,
      changedFiles: context.changedFiles.map((file) => ({
        oldPath: file.oldPath,
        newPath: file.newPath,
        newFile: file.newFile,
        renamedFile: file.renamedFile,
        deletedFile: file.deletedFile,
      })),
    });
  },
};

function resolveMergeRequestReference(
  reference: string,
  context: GitLabMergeRequestContext,
): { projectId: string; iid: number } {
  const parsed = parseGitLabReference(reference);

  if (parsed.kind !== "merge_request") {
    throw new Error(`Expected a merge request reference: ${reference}`);
  }

  return {
    projectId: parsed.projectId ?? context.gitlab.projectId,
    iid: parsed.iid,
  };
}

function readRequiredIid(iid: number | undefined): number {
  if (iid === undefined) {
    throw new Error("read_gitlab_mr requires iid or reference");
  }

  return iid;
}
