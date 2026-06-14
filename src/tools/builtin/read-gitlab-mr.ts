import { z } from "zod";

import {
  createGitLabReferenceContextClient,
  parseGitLabReference,
} from "../../gitlab/reference-context.js";
import {
  assertUnambiguousGitLabTarget,
  readGitLabToolToken,
} from "./gitlab-utils.js";
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

    if (
      input.iid !== undefined ||
      input.projectId !== undefined ||
      input.reference !== undefined
    ) {
      const target =
        input.reference === undefined
          ? {
              projectId: input.projectId ?? runtime.context.gitlab.projectId,
              iid: readRequiredIid(input.iid),
            }
          : resolveMergeRequestReference(input.reference, runtime);
      const client = createGitLabReferenceContextClient({
        apiUrl: runtime.context.gitlab.apiUrl,
        token: readGitLabToolToken(runtime),
      });

      return client.getMergeRequest(target.projectId, target.iid);
    }

    return Promise.resolve({
      source: runtime.context.source,
      gitlab: runtime.context.gitlab,
      mergeRequest: runtime.context.mergeRequest,
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

function resolveMergeRequestReference(
  reference: string,
  runtime: Parameters<ToolImplementation["execute"]>[1],
): { projectId: string; iid: number } {
  const parsed = parseGitLabReference(reference);

  if (parsed.kind !== "merge_request") {
    throw new Error(`Expected a merge request reference: ${reference}`);
  }

  return {
    projectId: parsed.projectId ?? runtime.context.gitlab.projectId,
    iid: parsed.iid,
  };
}

function readRequiredIid(iid: number | undefined): number {
  if (iid === undefined) {
    throw new Error("read_gitlab_mr requires iid or reference");
  }

  return iid;
}
