import { describe, expect, it } from "vitest";

import {
  createGitLabMergeRequestDiscussionClient,
  createInlineDiscussionBody,
  createInlineDiscussionFingerprint,
  publishMergeRequestInlineDiscussions,
  type GitLabMergeRequestDiscussionClient,
} from "../../src/gitlab/inline-discussions.js";
import type { GitLabMergeRequestContext } from "../../src/gitlab/mr-context.js";
import {
  createReviewPublicationPlan,
  mapFindingToDiffPosition,
} from "../../src/gitlab/review-publication-plan.js";
import type { GitLabMergeRequestNoteClient } from "../../src/gitlab/summary-note.js";
import type { ReviewFinding, ReviewReport } from "../../src/review/report.js";
import {
  createGitLabRequestError,
  createGitLabSdkClient,
} from "./gitlab-sdk-test-utils.js";

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

describe("publishMergeRequestInlineDiscussions", () => {
  it("uses stable inline fingerprints when finding wording changes", () => {
    const context = createContext();
    const position = mapFindingToDiffPosition({
      context,
      finding: createFinding({
        title: "Original wording",
        body: "The model phrased this one way.",
        suggestion: "Do one thing.",
        replacementCode: "",
      }),
    });

    if (position === undefined) {
      throw new Error("Expected finding to map to a diff position");
    }

    const originalFingerprint = createInlineDiscussionFingerprint({
      finding: createFinding({
        title: "Original wording",
        body: "The model phrased this one way.",
        suggestion: "Do one thing.",
        replacementCode: "",
      }),
      position,
    });
    const rerunFingerprint = createInlineDiscussionFingerprint({
      finding: createFinding({
        title: "Different wording",
        body: "The model phrased this differently on a later run.",
        suggestion: "Do another equivalent thing.",
        replacementCode: "",
      }),
      position,
    });

    expect(rerunFingerprint).toBe(originalFingerprint);
    expect(
      createInlineDiscussionFingerprint({
        finding: createFinding({
          severity: "high",
          title: "Different severity",
        }),
        position,
      }),
    ).not.toBe(originalFingerprint);
  });

  it("uses stable inline fingerprints when the MR head SHA changes", () => {
    const originalContext = createContext();
    const rerunContext: GitLabMergeRequestContext = {
      ...originalContext,
      mergeRequest: {
        ...originalContext.mergeRequest,
        diffRefs: {
          ...originalContext.mergeRequest.diffRefs,
          headSha: "new-head-sha",
        },
      },
    };
    const finding = createFinding();
    const originalPosition = mapFindingToDiffPosition({
      context: originalContext,
      finding,
    });
    const rerunPosition = mapFindingToDiffPosition({
      context: rerunContext,
      finding,
    });

    if (originalPosition === undefined || rerunPosition === undefined) {
      throw new Error("Expected finding to map to both diff positions");
    }

    expect(rerunPosition.headSha).not.toBe(originalPosition.headSha);
    expect(
      createInlineDiscussionFingerprint({
        finding,
        position: rerunPosition,
      }),
    ).toBe(
      createInlineDiscussionFingerprint({
        finding,
        position: originalPosition,
      }),
    );
  });

  it("renders inline discussion bodies like focused reviewer comments", () => {
    const context = createContext();
    const finding = createFinding({
      severity: "high",
      title: "Validate input before use",
      body: "The changed line trusts external input, which can make this path fail or behave unexpectedly when malformed data reaches it.",
      suggestion: "Validate or normalize the input before assigning it.",
      replacementCode: "const value = normalizeInput(input);",
    });
    const position = mapFindingToDiffPosition({
      context,
      finding,
    });

    if (position === undefined) {
      throw new Error("Expected finding to map to a diff position");
    }

    const body = createInlineDiscussionBody({
      finding,
      position,
    });
    const fingerprint = createInlineDiscussionFingerprint({
      finding,
      position,
    });

    expect(body).toBe(
      [
        "**Issue:**",
        "",
        "Validate input before use",
        "",
        "**Impact:**",
        "",
        "High",
        "",
        "**Why it matters:**",
        "",
        "The changed line trusts external input, which can make this path fail or behave unexpectedly when malformed data reaches it.",
        "",
        "**How to fix:**",
        "",
        "Validate or normalize the input before assigning it.",
        "",
        "```suggestion:-0+0",
        "const value = normalizeInput(input);",
        "```",
        "",
        `<!-- codereviewer:inline:${fingerprint} -->`,
      ].join("\n"),
    );
    expect(body).not.toContain("**[high]");
    expect(body).not.toContain("Suggestion:");
  });

  it("preserves multi-line replacement code in GitLab suggestion blocks", () => {
    const context = createContext();
    const finding = createFinding({
      suggestion: "Replace the partial normalization with a complete return.",
      replacementCode: [
        "  const value = normalizeInput(input);",
        "  return value;",
      ].join("\n"),
    });
    const position = mapFindingToDiffPosition({
      context,
      finding,
    });

    if (position === undefined) {
      throw new Error("Expected finding to map to a diff position");
    }

    const body = createInlineDiscussionBody({
      finding,
      position,
    });

    expect(body).toContain(
      [
        "```suggestion:-0+0",
        "  const value = normalizeInput(input);",
        "  return value;",
        "```",
      ].join("\n"),
    );
  });

  it("keeps fenced replacement code as plain reviewer text", () => {
    const context = createContext();
    const finding = createFinding({
      suggestion:
        "Avoid rendering an applyable suggestion when the replacement contains Markdown fences.",
      replacementCode: ['  const marker = "```";', "  return marker;"].join(
        "\n",
      ),
    });
    const position = mapFindingToDiffPosition({
      context,
      finding,
    });

    if (position === undefined) {
      throw new Error("Expected finding to map to a diff position");
    }

    const body = createInlineDiscussionBody({
      finding,
      position,
    });

    expect(body).toContain("**How to fix:**");
    expect(body).toContain(
      "Avoid rendering an applyable suggestion when the replacement contains Markdown fences.",
    );
    expect(body).not.toContain("```suggestion");
    expect(body).not.toContain('const marker = "```";');
  });

  it("omits the fix section when an inline finding has no suggestion", () => {
    const context = createContext();
    const finding = createFinding({
      suggestion: "",
      replacementCode: "",
    });
    const position = mapFindingToDiffPosition({
      context,
      finding,
    });

    if (position === undefined) {
      throw new Error("Expected finding to map to a diff position");
    }

    const body = createInlineDiscussionBody({
      finding,
      position,
    });

    expect(body).toContain("**Issue:**\n\nCheck value");
    expect(body).toContain("**Impact:**\n\nMedium");
    expect(body).toContain(
      "**Why it matters:**\n\nThe changed line needs review.",
    );
    expect(body).not.toContain("**How to fix:**");
    expect(body).toContain("<!-- codereviewer:inline:");
  });

  it("keeps non-applyable fixes as plain reviewer text", () => {
    const context = createContext();
    const finding = createFinding({
      suggestion: "Consider a broader refactor before changing this call.",
      replacementCode: "",
    });
    const position = mapFindingToDiffPosition({
      context,
      finding,
    });

    if (position === undefined) {
      throw new Error("Expected finding to map to a diff position");
    }

    const body = createInlineDiscussionBody({
      finding,
      position,
    });

    expect(body).toContain("**How to fix:**");
    expect(body).toContain(
      "Consider a broader refactor before changing this call.",
    );
    expect(body).not.toContain("```suggestion");
  });

  it("renders inline discussion bodies from a Markdown template", () => {
    const context = createContext();
    const finding = createFinding({
      suggestion: "",
      replacementCode: "const value = normalizeInput(input);",
    });
    const position = mapFindingToDiffPosition({
      context,
      finding,
    });

    if (position === undefined) {
      throw new Error("Expected finding to map to a diff position");
    }

    const body = createInlineDiscussionBody({
      finding,
      position,
      template: [
        "### {{finding.title}}",
        "",
        "Severity: {{comment.severityLabel}}",
        "Location: {{comment.location}}",
        "Suggestion: {{finding.suggestion}}",
        "",
        "Patch:",
        "{{comment.suggestionBlock}}",
        "",
        "Unknown: {{finding.titel}}",
      ].join("\n"),
    });
    const fingerprint = createInlineDiscussionFingerprint({
      finding,
      position,
    });

    expect(body).toBe(
      [
        "### Check value",
        "",
        "Severity: Medium",
        "Location: src/new.ts:1 (new)",
        "Suggestion: ",
        "",
        "Patch:",
        "```suggestion:-0+0",
        "const value = normalizeInput(input);",
        "```",
        "",
        "Unknown: {{finding.titel}}",
        "",
        `<!-- codereviewer:inline:${fingerprint} -->`,
      ].join("\n"),
    );
  });

  it("preserves finding text that looks like an unknown placeholder token", () => {
    const context = createContext();
    const finding = createFinding({
      body: "The value contains __CODE_REVIEWER_UNKNOWN_PLACEHOLDER_0__ text.",
    });
    const position = mapFindingToDiffPosition({
      context,
      finding,
    });

    if (position === undefined) {
      throw new Error("Expected finding to map to a diff position");
    }

    const body = createInlineDiscussionBody({
      finding,
      position,
      template: [
        "Unknown: {{finding.titel}}",
        "Body: {{finding.body}}",
        "{{comment.fingerprint}}",
      ].join("\n"),
    });

    expect(body).toContain("Unknown: {{finding.titel}}");
    expect(body).toContain(
      "Body: The value contains __CODE_REVIEWER_UNKNOWN_PLACEHOLDER_0__ text.",
    );
  });

  it("preserves unknown triple-stash template placeholders", () => {
    const context = createContext();
    const finding = createFinding();
    const position = mapFindingToDiffPosition({
      context,
      finding,
    });

    if (position === undefined) {
      throw new Error("Expected finding to map to a diff position");
    }

    const body = createInlineDiscussionBody({
      finding,
      position,
      template: [
        "Known: {{{finding.title}}}",
        "Unknown: {{{finding.titel}}}",
        "{{comment.fingerprint}}",
      ].join("\n"),
    });

    expect(body).toContain("Known: Check value");
    expect(body).toContain("Unknown: {{{finding.titel}}}");
  });

  it("preserves unknown single-segment template placeholders", () => {
    const context = createContext();
    const finding = createFinding();
    const position = mapFindingToDiffPosition({
      context,
      finding,
    });

    if (position === undefined) {
      throw new Error("Expected finding to map to a diff position");
    }

    const body = createInlineDiscussionBody({
      finding,
      position,
      template: ["Unknown: {{foo}}", "{{comment.fingerprint}}"].join("\n"),
    });

    expect(body).toContain("Unknown: {{foo}}");
  });

  it("publishes mapped findings and skips existing fingerprints", async () => {
    const report = createReport({
      findings: [
        createFinding({
          title: "Existing finding",
          startLine: 1,
          endLine: 1,
        }),
        createFinding({
          title: "New finding",
          code: "second line",
          startLine: 2,
          endLine: 2,
        }),
      ],
    });
    const context = createContext([
      {
        oldPath: "src/old.ts",
        newPath: "src/new.ts",
        diff: "@@ -0,0 +1,2 @@\n+first line\n+second line",
        newFile: false,
        renamedFile: true,
        deletedFile: false,
      },
    ]);
    const existingFinding = report.findings[0];

    if (existingFinding === undefined) {
      throw new Error("Expected report to include an existing finding");
    }

    const existingPosition = mapFindingToDiffPosition({
      context,
      finding: existingFinding,
    });

    if (existingPosition === undefined) {
      throw new Error("Expected existing finding to map to a diff position");
    }

    const existingFingerprint = createInlineDiscussionFingerprint({
      finding: existingFinding,
      position: existingPosition,
    });
    const createdBodies: string[] = [];
    const discussionClient: GitLabMergeRequestDiscussionClient = {
      listMergeRequestDiscussions() {
        return Promise.resolve([
          {
            id: "discussion-1",
            notes: [
              {
                id: 10,
                body: `Existing note\n<!-- codereviewer:inline:${existingFingerprint} -->`,
              },
            ],
          },
        ]);
      },
      createMergeRequestDiscussion(_projectId, _mergeRequestIid, body) {
        createdBodies.push(body);
        return Promise.resolve({
          id: "discussion-2",
          notes: [
            {
              id: 11,
              body,
              webUrl: "https://gitlab.example.test/discussion/2",
            },
          ],
        });
      },
    };
    const summaryClient = createNoopSummaryClient();

    await expect(
      publishMergeRequestInlineDiscussions({
        context,
        discussionClient,
        plan: createPlan(context, report),
        summaryClient,
      }),
    ).resolves.toMatchObject({
      mode: "inline",
      created: 1,
      skipped: 1,
      unpublished: 0,
    });
    expect(createdBodies).toHaveLength(1);
    expect(createdBodies[0]).toContain("**Issue:**\n\nNew finding");
    expect(createdBodies[0]).toContain("<!-- codereviewer:inline:");
  });

  it("publishes inline discussions with a configured Markdown template", async () => {
    const createdBodies: string[] = [];
    const discussionClient: GitLabMergeRequestDiscussionClient = {
      listMergeRequestDiscussions() {
        return Promise.resolve([]);
      },
      createMergeRequestDiscussion(_projectId, _mergeRequestIid, body) {
        createdBodies.push(body);
        return Promise.resolve({
          id: "discussion-1",
          notes: [
            {
              id: 11,
              body,
            },
          ],
        });
      },
    };
    const context = createContext();
    const plan = createPlan(context, createReport());

    await expect(
      publishMergeRequestInlineDiscussions({
        context,
        discussionClient,
        inlineTemplate: "Templated: {{finding.title}}\n{{comment.fingerprint}}",
        plan,
        summaryClient: createNoopSummaryClient(),
      }),
    ).resolves.toMatchObject({
      mode: "inline",
      created: 1,
      skipped: 0,
      unpublished: 0,
    });

    expect(createdBodies).toEqual([
      expect.stringMatching(
        /^Templated: Check value\n<!-- codereviewer:inline:[a-f0-9]{64} -->$/u,
      ),
    ]);
  });

  it("publishes the summary note before creating inline discussions", async () => {
    const calls: string[] = [];
    const createdSummaryBodies: string[] = [];
    const createdDiscussionBodies: string[] = [];
    const discussionClient: GitLabMergeRequestDiscussionClient = {
      listMergeRequestDiscussions() {
        return Promise.resolve([]);
      },
      createMergeRequestDiscussion(_projectId, _mergeRequestIid, body) {
        calls.push("inline");
        createdDiscussionBodies.push(body);
        return Promise.resolve({
          id: "discussion-1",
          notes: [
            {
              id: 11,
              body,
            },
          ],
        });
      },
    };
    const summaryClient: GitLabMergeRequestNoteClient = {
      listMergeRequestNotes() {
        return Promise.resolve([]);
      },
      createMergeRequestNote(_projectId, _mergeRequestIid, body) {
        calls.push("summary");
        createdSummaryBodies.push(body);
        return Promise.resolve({
          id: 21,
          body,
        });
      },
    };

    const context = createContext();
    const report = createReport({
      findings: [
        createFinding({
          title: "Line issue",
        }),
      ],
    });

    await expect(
      publishMergeRequestInlineDiscussions({
        context,
        discussionClient,
        plan: createPlan(context, report),
        summaryClient,
      }),
    ).resolves.toMatchObject({
      mode: "inline",
      created: 1,
      skipped: 0,
      unpublished: 0,
      summary: {
        status: "created",
        noteId: 21,
      },
    });
    expect(calls).toEqual(["summary", "inline"]);
    expect(createdSummaryBodies).toHaveLength(1);
    expect(createdSummaryBodies[0]).toContain("Review complete.");
    expect(createdSummaryBodies[0]).toContain("Line issue");
    expect(createdDiscussionBodies).toHaveLength(1);
    expect(createdDiscussionBodies[0]).toContain("Line issue");
  });

  it("continues publishing later inline discussions when one create fails", async () => {
    const context = createContext([
      {
        oldPath: "src/old.ts",
        newPath: "src/new.ts",
        diff: "@@ -0,0 +1,2 @@\n+first line\n+second line",
        newFile: false,
        renamedFile: true,
        deletedFile: false,
      },
    ]);
    const report = createReport({
      findings: [
        createFinding({
          title: "First finding",
          code: "first line",
          startLine: 1,
          endLine: 1,
        }),
        createFinding({
          title: "Second finding",
          code: "second line",
          startLine: 2,
          endLine: 2,
        }),
      ],
    });
    const createdBodies: string[] = [];
    let createAttempts = 0;
    const discussionClient: GitLabMergeRequestDiscussionClient = {
      listMergeRequestDiscussions() {
        return Promise.resolve([]);
      },
      createMergeRequestDiscussion(_projectId, _mergeRequestIid, body) {
        createAttempts += 1;

        if (createAttempts === 1) {
          return Promise.reject(new Error("GitLab returned 500"));
        }

        createdBodies.push(body);
        return Promise.resolve({
          id: "discussion-2",
          notes: [
            {
              id: 11,
              body,
            },
          ],
        });
      },
    };

    await expect(
      publishMergeRequestInlineDiscussions({
        context,
        discussionClient,
        plan: createPlan(context, report),
        summaryClient: createNoopSummaryClient(),
      }),
    ).resolves.toMatchObject({
      mode: "inline",
      created: 1,
      skipped: 0,
      unpublished: 1,
    });
    expect(createAttempts).toBe(2);
    expect(createdBodies).toHaveLength(1);
    expect(createdBodies[0]).toContain("Second finding");
  });

  it("skips existing inline discussions when only finding wording changed", async () => {
    const context = createContext();
    const existingFinding = createFinding({
      title: "Original wording",
      body: "The model phrased this one way.",
      suggestion: "Do one thing.",
      replacementCode: "",
    });
    const rerunReport = createReport({
      findings: [
        createFinding({
          title: "Different wording",
          body: "The model phrased this differently on a later run.",
          suggestion: "Do another equivalent thing.",
          replacementCode: "",
        }),
      ],
    });
    const existingPosition = mapFindingToDiffPosition({
      context,
      finding: existingFinding,
    });

    if (existingPosition === undefined) {
      throw new Error("Expected existing finding to map to a diff position");
    }

    const existingFingerprint = createInlineDiscussionFingerprint({
      finding: existingFinding,
      position: existingPosition,
    });
    const createdBodies: string[] = [];
    const discussionClient: GitLabMergeRequestDiscussionClient = {
      listMergeRequestDiscussions() {
        return Promise.resolve([
          {
            id: "discussion-1",
            notes: [
              {
                id: 10,
                body: `Existing note\n<!-- codereviewer:inline:${existingFingerprint} -->`,
              },
            ],
          },
        ]);
      },
      createMergeRequestDiscussion(_projectId, _mergeRequestIid, body) {
        createdBodies.push(body);
        return Promise.resolve({
          id: "discussion-2",
          notes: [
            {
              id: 11,
              body,
            },
          ],
        });
      },
    };

    await expect(
      publishMergeRequestInlineDiscussions({
        context,
        discussionClient,
        plan: createPlan(context, rerunReport),
        summaryClient: createNoopSummaryClient(),
      }),
    ).resolves.toMatchObject({
      mode: "inline",
      created: 0,
      skipped: 1,
      unpublished: 0,
    });
    expect(createdBodies).toEqual([]);
  });

  it("skips existing inline discussions after a new MR commit", async () => {
    const originalContext = createContext();
    const rerunContext: GitLabMergeRequestContext = {
      ...originalContext,
      mergeRequest: {
        ...originalContext.mergeRequest,
        diffRefs: {
          ...originalContext.mergeRequest.diffRefs,
          headSha: "new-head-sha",
        },
      },
    };
    const finding = createFinding();
    const existingPosition = mapFindingToDiffPosition({
      context: originalContext,
      finding,
    });

    if (existingPosition === undefined) {
      throw new Error("Expected existing finding to map to a diff position");
    }

    const existingFingerprint = createInlineDiscussionFingerprint({
      finding,
      position: existingPosition,
    });
    const createdBodies: string[] = [];
    const discussionClient: GitLabMergeRequestDiscussionClient = {
      listMergeRequestDiscussions() {
        return Promise.resolve([
          {
            id: "discussion-1",
            notes: [
              {
                id: 10,
                body: `Existing note\n<!-- codereviewer:inline:${existingFingerprint} -->`,
              },
            ],
          },
        ]);
      },
      createMergeRequestDiscussion(_projectId, _mergeRequestIid, body) {
        createdBodies.push(body);
        return Promise.resolve({
          id: "discussion-2",
          notes: [
            {
              id: 11,
              body,
            },
          ],
        });
      },
    };

    const report = createReport({
      findings: [finding],
    });

    await expect(
      publishMergeRequestInlineDiscussions({
        context: rerunContext,
        discussionClient,
        plan: createPlan(rerunContext, report),
        summaryClient: createNoopSummaryClient(),
      }),
    ).resolves.toMatchObject({
      mode: "inline",
      created: 0,
      skipped: 1,
      unpublished: 0,
    });
    expect(createdBodies).toEqual([]);
  });

  it("leaves unmapped findings unpublished", async () => {
    const report = createReport({
      findings: [
        createFinding({
          title: "Needs summary",
          startLine: 99,
          endLine: 99,
        }),
      ],
    });
    const createdDiscussionBodies: string[] = [];
    const createdDiscussionPositions: unknown[] = [];
    const createdSummaryBodies: string[] = [];
    const discussionClient: GitLabMergeRequestDiscussionClient = {
      listMergeRequestDiscussions() {
        return Promise.resolve([]);
      },
      createMergeRequestDiscussion(
        _projectId,
        _mergeRequestIid,
        body,
        position,
      ) {
        createdDiscussionBodies.push(body);
        createdDiscussionPositions.push(position);
        return Promise.resolve({
          id: "discussion-33",
          notes: [
            {
              id: 34,
              body,
            },
          ],
        });
      },
    };
    const summaryClient: GitLabMergeRequestNoteClient = {
      listMergeRequestNotes() {
        return Promise.resolve([]);
      },
      createMergeRequestNote(_projectId, _mergeRequestIid, body) {
        createdSummaryBodies.push(body);
        return Promise.resolve({
          id: 33,
          body,
          webUrl: "https://gitlab.example.test/note/33",
        });
      },
    };

    const context = createContext();

    await expect(
      publishMergeRequestInlineDiscussions({
        context,
        discussionClient,
        plan: createPlan(context, report),
        summaryClient,
      }),
    ).resolves.toMatchObject({
      mode: "inline",
      created: 0,
      skipped: 0,
      unpublished: 1,
      summary: {
        status: "created",
        noteId: 33,
        noteUrl: "https://gitlab.example.test/note/33",
      },
    });
    expect(createdSummaryBodies).toHaveLength(1);
    expect(createdSummaryBodies[0]).toContain("Needs summary");
    expect(createdSummaryBodies[0]).toContain("`src/new.ts:99 (new)`");
    expect(createdDiscussionBodies).toEqual([]);
    expect(createdDiscussionPositions).toEqual([]);
  });

  it("publishes a summary note when the report has no findings", async () => {
    const report = createReport({
      findings: [],
    });
    const createdSummaryBodies: string[] = [];
    const discussionClient: GitLabMergeRequestDiscussionClient = {
      listMergeRequestDiscussions() {
        return Promise.resolve([]);
      },
      createMergeRequestDiscussion() {
        throw new Error("Discussion should not be created");
      },
    };
    const summaryClient: GitLabMergeRequestNoteClient = {
      listMergeRequestNotes() {
        return Promise.resolve([]);
      },
      createMergeRequestNote(_projectId, _mergeRequestIid, body) {
        createdSummaryBodies.push(body);
        return Promise.resolve({
          id: 35,
          body,
          webUrl: "https://gitlab.example.test/note/35",
        });
      },
    };

    const context = createContext();

    await expect(
      publishMergeRequestInlineDiscussions({
        context,
        discussionClient,
        plan: createPlan(context, report),
        summaryClient,
      }),
    ).resolves.toMatchObject({
      mode: "inline",
      created: 0,
      skipped: 0,
      unpublished: 0,
      summary: {
        status: "created",
        noteId: 35,
        noteUrl: "https://gitlab.example.test/note/35",
      },
    });
    expect(createdSummaryBodies).toHaveLength(1);
    expect(createdSummaryBodies[0]).toContain("Review complete.");
    expect(createdSummaryBodies[0]).toContain("No findings.");
  });
});

describe("createGitLabMergeRequestDiscussionClient", () => {
  it("lists and creates merge request discussions with GitBeaker", async () => {
    const calls: unknown[] = [];
    const client = createGitLabMergeRequestDiscussionClient({
      apiUrl: "https://gitlab.example.test/api/v4/",
      token: "secret-token",
      gitlab: createGitLabSdkClient({
        MergeRequestDiscussions: {
          all(projectId, mergeRequestIid, options) {
            calls.push(["all", projectId, mergeRequestIid, options?.perPage]);
            return Promise.resolve([
              {
                id: "discussion-1",
                notes: [
                  {
                    id: 10,
                    body: "Existing discussion",
                    web_url: "https://gitlab.example.test/discussion/1",
                  },
                ],
              },
            ]);
          },
          create(projectId, mergeRequestIid, body, options) {
            calls.push(["create", projectId, mergeRequestIid, body, options]);
            return Promise.resolve({
              id: "discussion-2",
              notes: [
                {
                  id: 11,
                  body: "Created discussion",
                  web_url: "https://gitlab.example.test/discussion/2",
                },
              ],
            });
          },
        },
      }),
    });
    const position = {
      positionType: "text" as const,
      baseSha: "base-sha",
      startSha: "start-sha",
      headSha: "head-sha",
      oldPath: "src/old.ts",
      newPath: "src/new.ts",
      newLine: 12,
      lineRange: {
        start: {
          type: "new" as const,
          lineCode: "line-code-start",
          newLine: 12,
        },
        end: {
          type: "new" as const,
          lineCode: "line-code-end",
          newLine: 14,
        },
      },
    };

    await expect(
      client.listMergeRequestDiscussions("group/project", "7"),
    ).resolves.toEqual([
      {
        id: "discussion-1",
        notes: [
          {
            id: 10,
            body: "Existing discussion",
            webUrl: "https://gitlab.example.test/discussion/1",
          },
        ],
      },
    ]);
    await expect(
      client.createMergeRequestDiscussion(
        "group/project",
        "7",
        "Created discussion",
        position,
      ),
    ).resolves.toEqual({
      id: "discussion-2",
      notes: [
        {
          id: 11,
          body: "Created discussion",
          webUrl: "https://gitlab.example.test/discussion/2",
        },
      ],
    });
    await expect(
      client.createMergeRequestDiscussion(
        "group/project",
        "7",
        "Created discussion without position",
      ),
    ).resolves.toEqual({
      id: "discussion-2",
      notes: [
        {
          id: 11,
          body: "Created discussion",
          webUrl: "https://gitlab.example.test/discussion/2",
        },
      ],
    });
    expect(calls).toEqual([
      ["all", "group/project", 7, 100],
      [
        "create",
        "group/project",
        7,
        "Created discussion",
        {
          position: {
            positionType: "text",
            baseSha: "base-sha",
            startSha: "start-sha",
            headSha: "head-sha",
            oldPath: "src/old.ts",
            newPath: "src/new.ts",
            newLine: 12,
            lineRange: {
              start: {
                type: "new",
                lineCode: "line-code-start",
                newLine: 12,
              },
              end: {
                type: "new",
                lineCode: "line-code-end",
                newLine: 14,
              },
            },
          },
        },
      ],
      [
        "create",
        "group/project",
        7,
        "Created discussion without position",
        undefined,
      ],
    ]);
  });

  it("reports GitLab discussion API failures clearly", async () => {
    const client = createGitLabMergeRequestDiscussionClient({
      apiUrl: "https://gitlab.example.test/api/v4",
      token: "bad-token",
      gitlab: createGitLabSdkClient({
        MergeRequestDiscussions: {
          all() {
            return Promise.reject(
              createGitLabRequestError({
                url: "https://gitlab.example.test/api/v4/projects/123/merge_requests/9/discussions",
                status: 403,
                statusText: "Forbidden",
              }),
            );
          },
        },
      }),
    });

    await expect(
      client.listMergeRequestDiscussions("123", "9"),
    ).rejects.toThrow(
      /GitLab discussions API request failed: 403 Forbidden .*merge_requests\/9\/discussions/,
    );
  });
});

function createReport({
  findings = [createFinding()],
}: {
  findings?: ReviewFinding[];
} = {}): ReviewReport {
  return {
    summary: "Review complete.",
    findings,
    toolCalls: [],
  };
}

function createPlan(context: GitLabMergeRequestContext, report: ReviewReport) {
  return createReviewPublicationPlan({
    context,
    publishMode: "inline",
    report,
  });
}

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

function createNoopSummaryClient(): GitLabMergeRequestNoteClient {
  return {
    listMergeRequestNotes() {
      return Promise.resolve([]);
    },
    createMergeRequestNote(_projectId, _mergeRequestIid, body) {
      return Promise.resolve({
        id: 1,
        body,
      });
    },
  };
}
