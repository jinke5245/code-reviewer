import { describe, expect, it } from "vitest";

import type { GitLabMergeRequestContext } from "../../src/gitlab/mr-context.js";
import {
  createReviewPublicationPlan,
  mapFindingToDiffPosition,
} from "../../src/gitlab/review-publication-plan.js";
import type { ReviewFinding, ReviewReport } from "../../src/review/report.js";

describe("mapFindingToDiffPosition", () => {
  it("maps added, deleted, and context lines to GitLab text positions", () => {
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

    expect(
      mapFindingToDiffPosition({
        context,
        finding: createFinding({
          path: "src/added.ts",
          code: "added line",
          startLine: 12,
          endLine: 12,
        }),
      }),
    ).toEqual({
      positionType: "text",
      baseSha: "base-sha",
      startSha: "start-sha",
      headSha: "head-sha",
      oldPath: "src/added.ts",
      newPath: "src/added.ts",
      newLine: 12,
      lineRange: {
        start: {
          type: "new",
          lineCode: "a09dc99cc87a5213f8353b6a401e9c60b70d8796_0_12",
          newLine: 12,
        },
        end: {
          type: "new",
          lineCode: "a09dc99cc87a5213f8353b6a401e9c60b70d8796_0_12",
          newLine: 12,
        },
      },
    });
    expect(
      mapFindingToDiffPosition({
        context,
        finding: createFinding({
          path: "src/deleted.ts",
          side: "old",
          code: "deleted line",
          startLine: 31,
          endLine: 31,
        }),
      }),
    ).toEqual({
      positionType: "text",
      baseSha: "base-sha",
      startSha: "start-sha",
      headSha: "head-sha",
      oldPath: "src/deleted.ts",
      newPath: "src/deleted.ts",
      oldLine: 31,
      lineRange: {
        start: {
          type: "old",
          lineCode: "f11a08ec554ce29b0d66efaf548bce632724769a_31_0",
          oldLine: 31,
        },
        end: {
          type: "old",
          lineCode: "f11a08ec554ce29b0d66efaf548bce632724769a_31_0",
          oldLine: 31,
        },
      },
    });
    expect(
      mapFindingToDiffPosition({
        context,
        finding: createFinding({
          path: "src/context.ts",
          code: "context line",
          startLine: 41,
          endLine: 41,
        }),
      }),
    ).toEqual({
      positionType: "text",
      baseSha: "base-sha",
      startSha: "start-sha",
      headSha: "head-sha",
      oldPath: "src/context.ts",
      newPath: "src/context.ts",
      oldLine: 41,
      newLine: 41,
      lineRange: {
        start: {
          type: "new",
          lineCode: "bf61c9a0e0688d304d7c06966da92452e0024612_41_41",
          oldLine: 41,
          newLine: 41,
        },
        end: {
          type: "new",
          lineCode: "bf61c9a0e0688d304d7c06966da92452e0024612_41_41",
          oldLine: 41,
          newLine: 41,
        },
      },
    });
  });

  it("maps hunk content lines that start with file-header marker text", () => {
    const context = createContext([
      {
        oldPath: "src/markers.ts",
        newPath: "src/markers.ts",
        diff: "@@ -5,1 +6,1 @@\n----deleted marker\n++++added marker",
        newFile: false,
        renamedFile: false,
        deletedFile: false,
      },
    ]);

    expect(
      mapFindingToDiffPosition({
        context,
        finding: createFinding({
          path: "src/markers.ts",
          side: "old",
          code: "---deleted marker",
          startLine: 5,
          endLine: 5,
        }),
      }),
    ).toEqual({
      positionType: "text",
      baseSha: "base-sha",
      startSha: "start-sha",
      headSha: "head-sha",
      oldPath: "src/markers.ts",
      newPath: "src/markers.ts",
      oldLine: 5,
      lineRange: {
        start: {
          type: "old",
          lineCode: "6b277c2d0879a692934c596b7436a894696148ce_5_0",
          oldLine: 5,
        },
        end: {
          type: "old",
          lineCode: "6b277c2d0879a692934c596b7436a894696148ce_5_0",
          oldLine: 5,
        },
      },
    });
    expect(
      mapFindingToDiffPosition({
        context,
        finding: createFinding({
          path: "src/markers.ts",
          code: "+++added marker",
          startLine: 6,
          endLine: 6,
        }),
      }),
    ).toEqual({
      positionType: "text",
      baseSha: "base-sha",
      startSha: "start-sha",
      headSha: "head-sha",
      oldPath: "src/markers.ts",
      newPath: "src/markers.ts",
      newLine: 6,
      lineRange: {
        start: {
          type: "new",
          lineCode: "6b277c2d0879a692934c596b7436a894696148ce_0_6",
          newLine: 6,
        },
        end: {
          type: "new",
          lineCode: "6b277c2d0879a692934c596b7436a894696148ce_0_6",
          newLine: 6,
        },
      },
    });
  });

  it("maps multi-line finding ranges to GitLab line ranges", () => {
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

    const position = mapFindingToDiffPosition({
      context,
      finding: createFinding({
        path: "src/range.ts",
        code: "first line\nsecond line\nthird line",
        startLine: 10,
        endLine: 12,
      }),
    });

    expect(position).toMatchObject({
      positionType: "text",
      oldPath: "src/range.ts",
      newPath: "src/range.ts",
      newLine: 12,
      lineRange: {
        start: {
          type: "new",
          newLine: 10,
        },
        end: {
          type: "new",
          newLine: 12,
        },
      },
    });
    expect(position?.lineRange?.start.lineCode).toMatch(/_0_10$/u);
    expect(position?.lineRange?.end.lineCode).toMatch(/_0_12$/u);
  });

  it("anchors multi-line deleted ranges at the old-side range end", () => {
    const context = createContext([
      {
        oldPath: "src/deleted-range.ts",
        newPath: "src/deleted-range.ts",
        diff: "@@ -20,3 +0,0 @@\n-first line\n-second line\n-third line",
        newFile: false,
        renamedFile: false,
        deletedFile: false,
      },
    ]);

    const position = mapFindingToDiffPosition({
      context,
      finding: createFinding({
        path: "src/deleted-range.ts",
        side: "old",
        code: "first line\nsecond line\nthird line",
        startLine: 20,
        endLine: 22,
      }),
    });

    expect(position).toMatchObject({
      positionType: "text",
      oldPath: "src/deleted-range.ts",
      newPath: "src/deleted-range.ts",
      oldLine: 22,
      lineRange: {
        start: {
          type: "old",
          oldLine: 20,
        },
        end: {
          type: "old",
          oldLine: 22,
        },
      },
    });
    expect(position?.lineRange?.start.lineCode).toMatch(/_20_0$/u);
    expect(position?.lineRange?.end.lineCode).toMatch(/_22_0$/u);
  });

  it("returns undefined when a finding cannot be mapped to a diff position", () => {
    expect(
      mapFindingToDiffPosition({
        context: createContext(),
        finding: createFinding({
          path: "src/new.ts",
          startLine: 99,
          endLine: 99,
        }),
      }),
    ).toBeUndefined();
  });
});

describe("createReviewPublicationPlan", () => {
  it("separates inline findings from unpublished unmapped findings", () => {
    const inlineFinding = createFinding({
      title: "Inline finding",
      startLine: 1,
      endLine: 1,
    });
    const unmappedFinding = createFinding({
      path: "src/helper.ts",
      startLine: 12,
      endLine: 12,
      title: "Unmapped finding",
    });
    const report: ReviewReport = {
      summary: "Review complete.",
      findings: [inlineFinding, unmappedFinding],
      promptSummary: {
        extraRules: 0,
        totalBytes: 100,
        messages: [],
      },
      toolCalls: [
        {
          id: "call_1",
          name: "read_file",
        },
      ],
    };

    const plan = createReviewPublicationPlan({
      context: createContext(),
      publishMode: "inline",
      report,
    });

    expect(plan).toMatchObject({
      overview: {
        commit: "head-sha",
        changedFiles: 1,
        findings: 2,
        highestSeverity: "medium",
        inlineFindings: 1,
        unmappedFindings: 1,
        publishMode: "inline",
      },
      summary: "Review complete.",
      findings: [inlineFinding, unmappedFinding],
      unmappedFindings: [unmappedFinding],
      promptSummary: {
        totalBytes: 100,
      },
      toolCalls: [
        {
          id: "call_1",
          name: "read_file",
        },
      ],
    });
    expect(plan.inlineFindings).toHaveLength(1);
    expect(plan.inlineFindings[0]?.finding).toBe(inlineFinding);
    expect(plan.inlineFindings[0]?.position).toMatchObject({
      newPath: "src/new.ts",
      newLine: 1,
    });
  });

  it("uses none as highest severity when the review has no findings", () => {
    const plan = createReviewPublicationPlan({
      context: createContext(),
      publishMode: "dry-run",
      report: {
        summary: "No findings.",
        findings: [],
        toolCalls: [],
      },
    });

    expect(plan.overview).toEqual({
      provider: "gitlab",
      commit: "head-sha",
      changedFiles: 1,
      findings: 0,
      highestSeverity: "none",
      inlineFindings: 0,
      unmappedFindings: 0,
      publishMode: "dry-run",
    });
  });
});

function createFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    path: "src/new.ts",
    side: "new",
    startLine: 1,
    endLine: 1,
    code: "first line",
    severity: "medium",
    title: "Check value",
    body: "The changed line needs review.",
    suggestion: "Adjust the implementation.",
    replacementCode: "",
    ...overrides,
  };
}

function createContext(
  changedFiles: GitLabMergeRequestContext["changedFiles"] = [
    {
      oldPath: "src/old.ts",
      newPath: "src/new.ts",
      diff: "@@ -0,0 +1,2 @@\n+first line\n+second line",
      newFile: false,
      renamedFile: true,
      deletedFile: false,
    },
  ],
): GitLabMergeRequestContext {
  return {
    source: "gitlab-merge-request",
    provider: "gitlab",
    gitlab: {
      apiUrl: "https://gitlab.example.test/api/v4",
      projectId: "123",
      mergeRequestIid: "9",
    },
    mergeRequest: {
      title: "Add inline review",
      description: "Publish findings as discussions.",
      diffRefs: {
        baseSha: "base-sha",
        startSha: "start-sha",
        headSha: "head-sha",
      },
    },
    pullRequest: {
      title: "Add inline review",
      description: "Publish findings as discussions.",
      headSha: "head-sha",
    },
    changedFiles,
    platform: {
      gitlab: {
        apiUrl: "https://gitlab.example.test/api/v4",
        projectId: "123",
        mergeRequestIid: "9",
        diffRefs: {
          baseSha: "base-sha",
          startSha: "start-sha",
          headSha: "head-sha",
        },
      },
    },
  };
}
