import { z } from "zod";

import { createGitHubPullRequestCommentsClient } from "../../github/pull-request-comments.js";
import { readGitHubToolToken } from "./github-utils.js";
import type { ToolImplementation } from "../types.js";

const inputSchema = z
  .object({
    limit: z.number().int().positive().max(100).default(100),
  })
  .strict();

export const readGitHubPrCommentsTool: ToolImplementation = {
  inputSchema,
  async execute(args, runtime) {
    const input = inputSchema.parse(args);
    const github = runtime.context.platform.github;

    if (runtime.context.provider !== "github" || github === undefined) {
      throw new Error(
        "read_github_pr_comments requires a GitHub pull request context",
      );
    }

    const client = createGitHubPullRequestCommentsClient({
      apiUrl: github.apiUrl,
      token: readGitHubToolToken(runtime),
    });
    const [issueComments, reviewComments] = await Promise.all([
      client.listIssueComments(github.owner, github.repo, github.pullNumber),
      client.listReviewComments(github.owner, github.repo, github.pullNumber),
    ]);

    return {
      owner: github.owner,
      repo: github.repo,
      pullNumber: github.pullNumber,
      issueComments: issueComments.slice(0, input.limit),
      reviewComments: reviewComments.slice(0, input.limit),
    };
  },
};
