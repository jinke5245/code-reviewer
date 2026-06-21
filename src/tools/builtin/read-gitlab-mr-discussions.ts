import { z } from "zod";

import { readGitLabIid } from "../../gitlab/client.js";
import {
  createGitLabMergeRequestDiscussionClient,
  type GitLabMergeRequestDiscussion,
} from "../../gitlab/inline-discussions.js";
import { parseGitLabReference } from "../../gitlab/reference-context.js";
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
    limit: z.number().int().positive().max(100).default(100),
  })
  .strict();

export const readGitLabMrDiscussionsTool: ToolImplementation = {
  inputSchema,
  execute(args, runtime) {
    const input = inputSchema.parse(args);
    assertUnambiguousGitLabTarget(input);
    const context = readGitLabToolContext(runtime);
    const target = resolveMergeRequestTarget(input, context);
    const client = createGitLabMergeRequestDiscussionClient({
      apiUrl: context.gitlab.apiUrl,
      token: readGitLabToolToken(runtime),
    });

    return client
      .listMergeRequestDiscussions(target.projectId, String(target.iid))
      .then((discussions) => ({
        projectId: target.projectId,
        iid: target.iid,
        discussions: discussions.slice(0, input.limit).map(sanitizeDiscussion),
      }));
  },
};

function resolveMergeRequestTarget(
  input: z.infer<typeof inputSchema>,
  context: GitLabMergeRequestContext,
): { projectId: string; iid: number } {
  if (input.reference !== undefined) {
    return resolveMergeRequestReference(input.reference, context);
  }

  if (input.iid !== undefined || input.projectId !== undefined) {
    return {
      projectId: input.projectId ?? context.gitlab.projectId,
      iid: readRequiredIid(input.iid),
    };
  }

  return {
    projectId: context.gitlab.projectId,
    iid: readGitLabIid(context.gitlab.mergeRequestIid, "merge request IID"),
  };
}

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
    throw new Error("read_gitlab_mr_discussions requires iid or reference");
  }

  return iid;
}

function sanitizeDiscussion(
  discussion: GitLabMergeRequestDiscussion,
): GitLabMergeRequestDiscussion {
  return {
    id: discussion.id,
    ...(discussion.individualNote === undefined
      ? {}
      : { individualNote: discussion.individualNote }),
    notes: discussion.notes.map((note) => ({
      id: note.id,
      body: note.body,
      ...(note.authorUsername === undefined
        ? {}
        : { authorUsername: note.authorUsername }),
      ...(note.system === undefined ? {} : { system: note.system }),
      ...(note.resolvable === undefined ? {} : { resolvable: note.resolvable }),
      ...(note.resolved === undefined ? {} : { resolved: note.resolved }),
      ...(note.createdAt === undefined ? {} : { createdAt: note.createdAt }),
      ...(note.updatedAt === undefined ? {} : { updatedAt: note.updatedAt }),
      ...(note.webUrl === undefined ? {} : { webUrl: note.webUrl }),
    })),
  };
}
