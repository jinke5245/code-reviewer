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

export const readGitLabIssueTool: ToolImplementation = {
  inputSchema,
  execute(args, runtime) {
    const input = inputSchema.parse(args);
    assertUnambiguousGitLabTarget(input);
    const context = readGitLabToolContext(runtime);
    const target =
      input.reference === undefined
        ? {
            projectId: input.projectId ?? context.gitlab.projectId,
            iid: readRequiredIid(input.iid),
          }
        : resolveReference(input.reference, "issue", context);
    const client = createGitLabReferenceContextClient({
      apiUrl: context.gitlab.apiUrl,
      token: readGitLabToolToken(runtime),
    });

    return client.getIssue(target.projectId, target.iid);
  },
};

function resolveReference(
  reference: string,
  expectedKind: "issue",
  context: GitLabMergeRequestContext,
): { projectId: string; iid: number } {
  const parsed = parseGitLabReference(reference);

  if (parsed.kind !== expectedKind) {
    throw new Error(`Expected an issue reference: ${reference}`);
  }

  return {
    projectId: parsed.projectId ?? context.gitlab.projectId,
    iid: parsed.iid,
  };
}

function readRequiredIid(iid: number | undefined): number {
  if (iid === undefined) {
    throw new Error(
      "read_gitlab_issue requires an issue iid or reference; there is no default current issue",
    );
  }

  return iid;
}
