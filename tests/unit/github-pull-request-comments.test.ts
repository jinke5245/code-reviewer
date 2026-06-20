import { describe, expect, it } from "vitest";

import {
  createGitHubSummaryCommentBody,
  createGitHubInlineCommentBody,
} from "../../src/github/review-formatting.js";
import {
  publishPullRequestInlineComments,
  publishPullRequestSummaryComment,
  type GitHubPullRequestCommentsClient,
  type GitHubReviewCommentCreateInput,
} from "../../src/github/pull-request-comments.js";
import type { GitHubReviewPublicationPlan } from "../../src/github/review-publication-plan.js";
import type { ReviewTargetContext } from "../../src/platform/types.js";
import type { ReviewFinding } from "../../src/review/report.js";

describe("publishPullRequestSummaryComment", () => {
  it("creates a summary comment when no matching fingerprint exists", async () => {
    const createdBodies: string[] = [];
    const client = createCommentsClient({
      createIssueComment(_owner, _repo, _pullNumber, body) {
        createdBodies.push(body);
        return Promise.resolve({
          id: 101,
          body,
          htmlUrl: "https://github.test/comment/101",
        });
      },
    });

    await expect(
      publishPullRequestSummaryComment({
        client,
        context: createContext(),
        plan: createPlan(),
      }),
    ).resolves.toMatchObject({
      status: "created",
      commentId: 101,
      commentUrl: "https://github.test/comment/101",
    });
    expect(createdBodies[0]).toContain("Review summary.");
    expect(createdBodies[0]).toMatch(
      /<!-- codereviewer:summary:[a-f0-9]{64} -->/u,
    );
  });

  it("renders summary comments from a Markdown template", async () => {
    const createdBodies: string[] = [];
    const client = createCommentsClient({
      createIssueComment(_owner, _repo, _pullNumber, body) {
        createdBodies.push(body);
        return Promise.resolve({
          id: 101,
          body,
        });
      },
    });

    await publishPullRequestSummaryComment({
      client,
      context: createContext(),
      plan: createPlan(),
      summaryTemplate: [
        "GitHub summary: {{review.summary}}",
        "Provider: {{review.overview.provider}}",
        "Metadata: {{review.metadata.toolCalls}} / {{review.metadata.promptBytes}}",
        "{{comment.fingerprint}}",
      ].join("\n"),
    });

    expect(createdBodies[0]).toContain("GitHub summary: Review summary.");
    expect(createdBodies[0]).toContain("Provider: github");
    expect(createdBodies[0]).toContain("Metadata: 0 / 0");
    expect(createdBodies[0]?.match(/codereviewer:summary:/gu)).toHaveLength(1);
  });

  it("skips an existing summary comment with the same fingerprint", async () => {
    const plan = createPlan();
    const existingBody = createGitHubSummaryCommentBody(plan);
    const client = createCommentsClient({
      listIssueComments() {
        return Promise.resolve([
          {
            id: 101,
            body: existingBody,
            htmlUrl: "https://github.test/comment/101",
          },
        ]);
      },
      createIssueComment() {
        throw new Error("should not create duplicate summary");
      },
    });

    await expect(
      publishPullRequestSummaryComment({
        client,
        context: createContext(),
        plan,
      }),
    ).resolves.toMatchObject({
      status: "skipped",
      existingCommentId: 101,
      existingCommentUrl: "https://github.test/comment/101",
    });
  });
});

describe("publishPullRequestInlineComments", () => {
  it("publishes summary and missing inline review comments", async () => {
    const createdReviewComments: GitHubReviewCommentCreateInput[] = [];
    const client = createCommentsClient({
      createReviewComment(_owner, _repo, _pullNumber, comment) {
        createdReviewComments.push(comment);
        return Promise.resolve({
          id: 202,
          body: comment.body,
          htmlUrl: "https://github.test/comment/202",
        });
      },
    });

    await expect(
      publishPullRequestInlineComments({
        client,
        context: createContext(),
        plan: createPlan(),
      }),
    ).resolves.toMatchObject({
      mode: "inline",
      created: 1,
      skipped: 0,
      failed: 0,
      unpublished: 0,
    });
    expect(createdReviewComments).toMatchObject([
      {
        commitId: "head-sha",
        path: "src/new.ts",
        side: "RIGHT",
        line: 1,
      },
    ]);
    expect(createdReviewComments[0]?.body).toMatch(
      /<!-- codereviewer:inline:[a-f0-9]{64} -->/u,
    );
  });

  it("renders inline review comments from a Markdown template", async () => {
    const createdReviewComments: GitHubReviewCommentCreateInput[] = [];
    const client = createCommentsClient({
      createReviewComment(_owner, _repo, _pullNumber, comment) {
        createdReviewComments.push(comment);
        return Promise.resolve({
          id: 202,
          body: comment.body,
        });
      },
    });

    await publishPullRequestInlineComments({
      client,
      context: createContext(),
      inlineTemplate: [
        "GitHub inline: {{finding.title}}",
        "Location: {{comment.location}}",
        "Severity: {{comment.severityLabel}}",
        "Suggestion: {{comment.suggestionBlock}}",
        "{{comment.fingerprint}}",
      ].join("\n"),
      plan: createPlan(),
      summaryTemplate: "GitHub summary: {{review.summary}}",
    });

    expect(createdReviewComments[0]?.body).toContain(
      "GitHub inline: Check value",
    );
    expect(createdReviewComments[0]?.body).toContain(
      "Location: src/new.ts:1 (new)",
    );
    expect(createdReviewComments[0]?.body).toContain("Severity: Medium");
    expect(createdReviewComments[0]?.body).toContain("Suggestion: ");
    expect(
      createdReviewComments[0]?.body.match(/codereviewer:inline:/gu),
    ).toHaveLength(1);
  });

  it("skips inline review comments with existing fingerprints", async () => {
    const plan = createPlan();
    const inlineFinding = plan.inlineFindings[0];

    if (inlineFinding === undefined) {
      throw new Error("Expected test plan to include an inline finding");
    }

    const existingBody = createGitHubInlineCommentBody(inlineFinding);
    const client = createCommentsClient({
      listReviewComments() {
        return Promise.resolve([
          {
            id: 202,
            body: existingBody,
          },
        ]);
      },
      createReviewComment() {
        throw new Error("should not create duplicate inline comment");
      },
    });

    await expect(
      publishPullRequestInlineComments({
        client,
        context: createContext(),
        plan,
      }),
    ).resolves.toMatchObject({
      created: 0,
      skipped: 1,
      failed: 0,
      unpublished: 0,
    });
  });
});

function createCommentsClient(
  overrides: Partial<GitHubPullRequestCommentsClient> = {},
): GitHubPullRequestCommentsClient {
  return {
    listIssueComments: () => Promise.resolve([]),
    createIssueComment: (_owner, _repo, _pullNumber, body) =>
      Promise.resolve({ id: 101, body }),
    listReviewComments: () => Promise.resolve([]),
    createReviewComment: (_owner, _repo, _pullNumber, comment) =>
      Promise.resolve({ id: 202, body: comment.body }),
    ...overrides,
  };
}

function createContext(): ReviewTargetContext {
  return {
    source: "github-pull-request",
    provider: "github",
    pullRequest: {
      title: "Add GitHub publishing",
      description: "Publish review comments on GitHub.",
      headSha: "head-sha",
    },
    changedFiles: [],
    platform: {
      github: {
        apiUrl: "https://api.github.test",
        owner: "acme",
        repo: "repo",
        pullNumber: 12,
      },
    },
  };
}

function createPlan(): GitHubReviewPublicationPlan {
  const finding = createFinding();

  return {
    overview: {
      provider: "github",
      changedFiles: 1,
      commit: "head-sha",
      findings: 1,
      highestSeverity: "medium",
      inlineFindings: 1,
      publishMode: "inline",
      unmappedFindings: 0,
    },
    summary: "Review summary.",
    findings: [finding],
    inlineFindings: [
      {
        finding,
        position: {
          commitId: "head-sha",
          path: "src/new.ts",
          side: "RIGHT",
          line: 1,
        },
      },
    ],
    unmappedFindings: [],
    toolCalls: [],
  };
}

function createFinding(): ReviewFinding {
  return {
    path: "src/new.ts",
    side: "new",
    startLine: 1,
    endLine: 1,
    code: "new",
    severity: "medium",
    title: "Check value",
    body: "The new value needs review.",
    suggestion: "Explain why this value is safe.",
    replacementCode: "",
  };
}
