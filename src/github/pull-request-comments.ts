import {
  createGitHubInlineCommentBody,
  createGitHubInlineCommentFingerprint,
  createGitHubSummaryCommentBody,
  createGitHubSummaryCommentFingerprint,
} from "./review-formatting.js";
import type {
  GitHubReviewCommentPosition,
  GitHubReviewPublicationPlan,
} from "./review-publication-plan.js";
import type { ReviewTargetContext } from "../platform/types.js";
import {
  asRecord,
  readNumber,
  readOptionalString,
  readString,
} from "../platform/response-utils.js";
import { createGitHubOctokit, withGitHubApiError } from "./octokit.js";

export type GitHubIssueComment = {
  id: number;
  body: string;
  authorLogin?: string;
  htmlUrl?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type GitHubReviewComment = GitHubIssueComment & {
  path?: string;
  side?: string;
  line?: number;
  startLine?: number;
};

export type GitHubPullRequestCommentsListOptions = {
  limit?: number;
};

export type GitHubPullRequestCommentsClient = {
  listIssueComments: (
    owner: string,
    repo: string,
    pullNumber: number,
    options?: GitHubPullRequestCommentsListOptions,
  ) => Promise<GitHubIssueComment[]>;
  listReviewComments: (
    owner: string,
    repo: string,
    pullNumber: number,
    options?: GitHubPullRequestCommentsListOptions,
  ) => Promise<GitHubReviewComment[]>;
  createIssueComment: (
    owner: string,
    repo: string,
    pullNumber: number,
    body: string,
  ) => Promise<GitHubIssueComment>;
  createReviewComment: (
    owner: string,
    repo: string,
    pullNumber: number,
    comment: GitHubReviewCommentCreateInput,
  ) => Promise<GitHubReviewComment>;
};

export type GitHubReviewCommentCreateInput = GitHubReviewCommentPosition & {
  body: string;
};

export type PublishPullRequestSummaryCommentResult =
  | {
      status: "created";
      fingerprint: string;
      commentId: number;
      commentUrl?: string;
    }
  | {
      status: "skipped";
      fingerprint: string;
      existingCommentId: number;
      existingCommentUrl?: string;
    };

export type PublishPullRequestInlineCommentsResult = {
  mode: "inline";
  created: number;
  skipped: number;
  failed: number;
  unpublished: number;
  summary: PublishPullRequestSummaryCommentResult;
};

export type CreateGitHubPullRequestCommentsClientOptions = {
  apiUrl: string;
  token: string;
  fetch?: typeof fetch;
};

/** Creates a REST-backed GitHub pull request comments client. */
export function createGitHubPullRequestCommentsClient({
  apiUrl,
  token,
  fetch: fetchImplementation,
}: CreateGitHubPullRequestCommentsClientOptions): GitHubPullRequestCommentsClient {
  const octokit = createGitHubOctokit({
    apiUrl,
    token,
    ...(fetchImplementation === undefined
      ? {}
      : { fetch: fetchImplementation }),
  });

  return {
    async listIssueComments(owner, repo, pullNumber, options = {}) {
      const path = `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues/${String(pullNumber)}/comments`;
      const limit = readCommentListLimit(options);
      const items = await withGitHubApiError(path, async () => {
        const request = {
          owner,
          repo,
          issue_number: pullNumber,
          per_page: readCommentsPerPage(limit),
        };

        if (limit === undefined) {
          return await octokit.paginate(
            octokit.rest.issues.listComments,
            request,
          );
        }

        const limitedItems: unknown[] = [];

        for await (const response of octokit.paginate.iterator(
          octokit.rest.issues.listComments,
          request,
        )) {
          limitedItems.push(...response.data);

          if (limitedItems.length >= limit) {
            break;
          }
        }

        return limitedItems.slice(0, limit);
      });

      return items.map(parseIssueComment);
    },

    async listReviewComments(owner, repo, pullNumber, options = {}) {
      const path = `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/${String(pullNumber)}/comments`;
      const limit = readCommentListLimit(options);
      const items = await withGitHubApiError(path, async () => {
        const request = {
          owner,
          repo,
          pull_number: pullNumber,
          per_page: readCommentsPerPage(limit),
        };

        if (limit === undefined) {
          return await octokit.paginate(
            octokit.rest.pulls.listReviewComments,
            request,
          );
        }

        const limitedItems: unknown[] = [];

        for await (const response of octokit.paginate.iterator(
          octokit.rest.pulls.listReviewComments,
          request,
        )) {
          limitedItems.push(...response.data);

          if (limitedItems.length >= limit) {
            break;
          }
        }

        return limitedItems.slice(0, limit);
      });

      return items.map(parseReviewComment);
    },

    async createIssueComment(owner, repo, pullNumber, body) {
      return parseIssueComment(
        (
          await withGitHubApiError(
            `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/issues/${String(pullNumber)}/comments`,
            () =>
              octokit.rest.issues.createComment({
                owner,
                repo,
                issue_number: pullNumber,
                body,
              }),
          )
        ).data,
      );
    },

    async createReviewComment(owner, repo, pullNumber, comment) {
      return parseReviewComment(
        (
          await withGitHubApiError(
            `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/${String(pullNumber)}/comments`,
            () =>
              octokit.rest.pulls.createReviewComment({
                owner,
                repo,
                pull_number: pullNumber,
                ...toGitHubReviewCommentRequest(comment),
              }),
          )
        ).data,
      );
    },
  };
}

export async function publishPullRequestSummaryComment({
  client,
  context,
  plan,
  summaryTemplate,
}: {
  client: GitHubPullRequestCommentsClient;
  context: ReviewTargetContext;
  plan: GitHubReviewPublicationPlan;
  summaryTemplate?: string;
}): Promise<PublishPullRequestSummaryCommentResult> {
  const github = readGitHubContext(context);
  const fingerprint = createGitHubSummaryCommentFingerprint(plan);
  const fingerprintMarker = `<!-- codereviewer:summary:${fingerprint} -->`;
  const existingComments = await client.listIssueComments(
    github.owner,
    github.repo,
    github.pullNumber,
  );
  const existingComment = existingComments.find((comment) =>
    comment.body.includes(fingerprintMarker),
  );

  if (existingComment !== undefined) {
    return {
      status: "skipped",
      fingerprint,
      existingCommentId: existingComment.id,
      ...(existingComment.htmlUrl === undefined
        ? {}
        : { existingCommentUrl: existingComment.htmlUrl }),
    };
  }

  const comment = await client.createIssueComment(
    github.owner,
    github.repo,
    github.pullNumber,
    createGitHubSummaryCommentBody(
      plan,
      summaryTemplate === undefined ? {} : { template: summaryTemplate },
    ),
  );

  return {
    status: "created",
    fingerprint,
    commentId: comment.id,
    ...(comment.htmlUrl === undefined ? {} : { commentUrl: comment.htmlUrl }),
  };
}

export async function publishPullRequestInlineComments({
  client,
  context,
  inlineTemplate,
  plan,
  summaryTemplate,
}: {
  client: GitHubPullRequestCommentsClient;
  context: ReviewTargetContext;
  inlineTemplate?: string;
  plan: GitHubReviewPublicationPlan;
  summaryTemplate?: string;
}): Promise<PublishPullRequestInlineCommentsResult> {
  const github = readGitHubContext(context);
  const summary = await publishPullRequestSummaryComment({
    client,
    context,
    plan,
    ...(summaryTemplate === undefined ? {} : { summaryTemplate }),
  });
  const existingReviewComments = await client.listReviewComments(
    github.owner,
    github.repo,
    github.pullNumber,
  );
  const existingInlineFingerprints = collectExistingInlineFingerprints(
    existingReviewComments,
  );
  let created = 0;
  let failed = 0;
  let skipped = 0;

  for (const inlineFinding of plan.inlineFindings) {
    const fingerprint = createGitHubInlineCommentFingerprint(inlineFinding);

    if (existingInlineFingerprints.has(fingerprint)) {
      skipped += 1;
      continue;
    }

    try {
      await client.createReviewComment(
        github.owner,
        github.repo,
        github.pullNumber,
        {
          ...inlineFinding.position,
          body: createGitHubInlineCommentBody(
            inlineFinding,
            inlineTemplate === undefined ? {} : { template: inlineTemplate },
          ),
        },
      );
    } catch {
      failed += 1;
      continue;
    }
    existingInlineFingerprints.add(fingerprint);
    created += 1;
  }

  return {
    mode: "inline",
    created,
    skipped,
    failed,
    unpublished: plan.unmappedFindings.length + failed,
    summary,
  };
}

function parseIssueComment(value: unknown): GitHubIssueComment {
  const data = asRecord(value, "GitHub API");

  return {
    id: readNumber(data, "id", "GitHub API"),
    body: readString(data, "body", "GitHub API"),
    ...readSharedCommentFields(data),
  };
}

function readCommentListLimit({
  limit,
}: GitHubPullRequestCommentsListOptions): number | undefined {
  if (limit === undefined) {
    return undefined;
  }

  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("Expected GitHub comments limit to be a positive integer");
  }

  return limit;
}

function readCommentsPerPage(limit: number | undefined): number {
  return limit === undefined ? 100 : Math.min(limit, 100);
}

function parseReviewComment(value: unknown): GitHubReviewComment {
  const data = asRecord(value, "GitHub API");
  const line = readOptionalNumber(data, "line");
  const startLine = readOptionalNumber(data, "start_line");
  const path = readOptionalString(data, "path", "GitHub API");
  const side = readOptionalString(data, "side", "GitHub API");

  return {
    id: readNumber(data, "id", "GitHub API"),
    body: readString(data, "body", "GitHub API"),
    ...readSharedCommentFields(data),
    ...(path === undefined ? {} : { path }),
    ...(side === undefined ? {} : { side }),
    ...(line === undefined ? {} : { line }),
    ...(startLine === undefined ? {} : { startLine }),
  };
}

function readSharedCommentFields(
  data: Record<string, unknown>,
): Omit<GitHubIssueComment, "body" | "id"> {
  const user = data.user;
  const authorLogin =
    typeof user === "object" && user !== null && !Array.isArray(user)
      ? readOptionalString(
          user as Record<string, unknown>,
          "login",
          "GitHub API",
        )
      : undefined;
  const htmlUrl = readOptionalString(data, "html_url", "GitHub API");
  const createdAt = readOptionalString(data, "created_at", "GitHub API");
  const updatedAt = readOptionalString(data, "updated_at", "GitHub API");

  return {
    ...(authorLogin === undefined ? {} : { authorLogin }),
    ...(htmlUrl === undefined ? {} : { htmlUrl }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

function readOptionalNumber(
  data: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = data[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "number") {
    return value;
  }

  throw new Error(`Expected GitHub API field ${key} to be a number`);
}

function collectExistingInlineFingerprints(
  comments: GitHubReviewComment[],
): Set<string> {
  const fingerprints = new Set<string>();
  const marker = new RegExp(
    "<!-- codereviewer:inline:([a-f0-9]{64}) -->",
    "gu",
  );

  for (const comment of comments) {
    for (const match of comment.body.matchAll(marker)) {
      const fingerprint = match[1];

      if (fingerprint !== undefined) {
        fingerprints.add(fingerprint);
      }
    }
  }

  return fingerprints;
}

function readGitHubContext(
  context: ReviewTargetContext,
): NonNullable<ReviewTargetContext["platform"]["github"]> {
  const github = context.platform.github;

  if (context.provider !== "github" || github === undefined) {
    throw new Error("Expected GitHub pull request context");
  }

  return github;
}

function toGitHubReviewCommentRequest(
  comment: GitHubReviewCommentCreateInput,
): {
  body: string;
  commit_id: string;
  line: number;
  path: string;
  side: GitHubReviewCommentPosition["side"];
  start_line?: number;
  start_side?: GitHubReviewCommentPosition["side"];
} {
  return {
    body: comment.body,
    commit_id: comment.commitId,
    path: comment.path,
    side: comment.side,
    line: comment.line,
    ...(comment.startLine === undefined
      ? {}
      : { start_line: comment.startLine }),
    ...(comment.startSide === undefined
      ? {}
      : { start_side: comment.startSide }),
  };
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}
