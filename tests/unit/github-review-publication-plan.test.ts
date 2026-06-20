import { describe, expect, it } from "vitest";

import { createGitHubReviewPublicationPlan } from "../../src/github/review-publication-plan.js";
import type { ReviewTargetContext } from "../../src/platform/types.js";
import type { ReviewFinding, ReviewReport } from "../../src/review/report.js";

describe("createGitHubReviewPublicationPlan", () => {
  it("maps added, deleted, and context lines to GitHub review comment positions", () => {
    const context = createContext([
      {
        oldPath: "src/added.ts",
        newPath: "src/added.ts",
        diff: "@@ -10,2 +10,3 @@\n context before\n context after\n+added line",
        newFile: false,
        renamedFile: false,
        deletedFile: false,
      },
      {
        oldPath: "src/deleted.ts",
        newPath: "src/deleted.ts",
        diff: "@@ -30,3 +100,2 @@\n context before\n-deleted line\n context after",
        newFile: false,
        renamedFile: false,
        deletedFile: false,
      },
      {
        oldPath: "src/context.ts",
        newPath: "src/context.ts",
        diff: "@@ -40,2 +40,2 @@\n context before\n context line",
        newFile: false,
        renamedFile: false,
        deletedFile: false,
      },
    ]);
    const report = createReport([
      createFinding({
        path: "src/added.ts",
        code: "added line",
        startLine: 12,
        endLine: 12,
      }),
      createFinding({
        path: "src/deleted.ts",
        side: "old",
        code: "deleted line",
        startLine: 31,
        endLine: 31,
      }),
      createFinding({
        path: "src/context.ts",
        code: "context line",
        startLine: 41,
        endLine: 41,
      }),
    ]);

    const plan = createGitHubReviewPublicationPlan({
      context,
      publishMode: "inline",
      report,
    });

    expect(plan.inlineFindings.map((item) => item.position)).toEqual([
      {
        commitId: "head-sha",
        path: "src/added.ts",
        side: "RIGHT",
        line: 12,
      },
      {
        commitId: "head-sha",
        path: "src/deleted.ts",
        side: "LEFT",
        line: 31,
      },
      {
        commitId: "head-sha",
        path: "src/context.ts",
        side: "RIGHT",
        line: 41,
      },
    ]);
  });

  it("maps multi-line ranges to GitHub review comment ranges", () => {
    const context = createContext([
      {
        oldPath: "src/range.ts",
        newPath: "src/range.ts",
        diff: "@@ -0,0 +10,3 @@\n+first line\n+second line\n+third line",
        newFile: true,
        renamedFile: false,
        deletedFile: false,
      },
    ]);

    const plan = createGitHubReviewPublicationPlan({
      context,
      publishMode: "inline",
      report: createReport([
        createFinding({
          path: "src/range.ts",
          code: "first line\nsecond line\nthird line",
          startLine: 10,
          endLine: 12,
        }),
      ]),
    });

    expect(plan.inlineFindings[0]?.position).toEqual({
      commitId: "head-sha",
      path: "src/range.ts",
      side: "RIGHT",
      startLine: 10,
      startSide: "RIGHT",
      line: 12,
    });
  });

  it("maps old-side multi-line ranges to GitHub review comment ranges", () => {
    const context = createContext([
      {
        oldPath: "src/deleted-range.ts",
        newPath: "src/deleted-range.ts",
        diff: "@@ -20,3 +20,0 @@\n-first line\n-second line\n-third line",
        newFile: false,
        renamedFile: false,
        deletedFile: false,
      },
    ]);

    const plan = createGitHubReviewPublicationPlan({
      context,
      publishMode: "inline",
      report: createReport([
        createFinding({
          path: "src/deleted-range.ts",
          side: "old",
          code: "first line\nsecond line\nthird line",
          startLine: 20,
          endLine: 22,
        }),
      ]),
    });

    expect(plan.inlineFindings[0]?.position).toEqual({
      commitId: "head-sha",
      path: "src/deleted-range.ts",
      side: "LEFT",
      startLine: 20,
      startSide: "LEFT",
      line: 22,
    });
  });

  it("uses the current PR file path for old-side comments on renamed files", () => {
    const context = createContext([
      {
        oldPath: "src/old-name.ts",
        newPath: "src/new-name.ts",
        diff: "@@ -1,1 +1,1 @@\n-old line\n+new line",
        newFile: false,
        renamedFile: true,
        deletedFile: false,
      },
    ]);

    const plan = createGitHubReviewPublicationPlan({
      context,
      publishMode: "inline",
      report: createReport([
        createFinding({
          path: "src/old-name.ts",
          side: "old",
          code: "old line",
          startLine: 1,
          endLine: 1,
        }),
      ]),
    });

    expect(plan.inlineFindings[0]?.position).toEqual({
      commitId: "head-sha",
      path: "src/new-name.ts",
      side: "LEFT",
      line: 1,
    });
  });

  it("keeps unmapped findings out of inline comments", () => {
    const plan = createGitHubReviewPublicationPlan({
      context: createContext([]),
      publishMode: "inline",
      report: createReport([
        createFinding({
          path: "src/missing.ts",
        }),
      ]),
    });

    expect(plan.inlineFindings).toEqual([]);
    expect(plan.unmappedFindings).toHaveLength(1);
    expect(plan.overview).toMatchObject({
      provider: "github",
      commit: "head-sha",
      changedFiles: 0,
      inlineFindings: 0,
      unmappedFindings: 1,
    });
  });
});

function createContext(
  changedFiles: ReviewTargetContext["changedFiles"],
): ReviewTargetContext {
  return {
    source: "github-pull-request",
    provider: "github",
    pullRequest: {
      title: "Add GitHub publishing",
      description: "Publish review comments on GitHub.",
      headSha: "head-sha",
    },
    changedFiles,
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

function createReport(findings: ReviewFinding[]): ReviewReport {
  return {
    summary: "Review summary.",
    findings,
    toolCalls: [],
  };
}

function createFinding(overrides: Partial<ReviewFinding>): ReviewFinding {
  return {
    path: "src/file.ts",
    side: "new",
    startLine: 1,
    endLine: 1,
    code: "line",
    severity: "medium",
    title: "Check line",
    body: "The line needs review.",
    suggestion: "Adjust the line.",
    replacementCode: "",
    ...overrides,
  };
}
