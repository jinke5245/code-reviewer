import { describe, expect, it } from "vitest";

import type { GitLabMergeRequestContext } from "../../src/gitlab/mr-context.js";
import { parseReviewReport } from "../../src/review/report.js";

describe("parseReviewReport", () => {
  it("parses canonical findings and attaches metadata", () => {
    const report = parseReviewReport({
      content: JSON.stringify({
        summary: "One actionable finding.",
        findings: [
          {
            path: "src/new.ts",
            side: "new",
            startLine: 1,
            endLine: 1,
            code: "const value = input;",
            severity: "high",
            title: "Validate input",
            body: "The new code trusts external input.",
            suggestion: "Validate the input before using it.",
            replacementCode: "const value = validate(input);",
          },
        ],
      }),
      context: createContext(),
      promptSummary: createPromptSummary(),
      toolCalls: [
        {
          id: "call_1",
          name: "read_diff",
        },
      ],
    });

    expect(report).toEqual({
      summary: "One actionable finding.",
      findings: [
        {
          path: "src/new.ts",
          side: "new",
          startLine: 1,
          endLine: 1,
          code: "const value = input;",
          severity: "high",
          title: "Validate input",
          body: "The new code trusts external input.",
          suggestion: "Validate the input before using it.",
          replacementCode: "const value = validate(input);",
        },
      ],
      promptSummary: createPromptSummary(),
      toolCalls: [
        {
          id: "call_1",
          name: "read_diff",
        },
      ],
    });
  });

  it("rejects finding ranges that do not exist in the merge request diff", () => {
    expect(() =>
      parseReviewReport({
        content: JSON.stringify({
          summary: "Invalid finding.",
          findings: [
            {
              path: "src/new.ts",
              side: "new",
              startLine: 99,
              endLine: 101,
              code: "missing code",
              severity: "medium",
              title: "Check surrounding behavior",
              body: "This concern is outside the merge request diff hunks.",
              suggestion: "Review the surrounding branch behavior.",
              replacementCode: "",
            },
          ],
        }),
        context: createContext(),
      }),
    ).toThrow(/Invalid review report: findings\.0 code range/);
  });

  it("rejects finding code that does not match the selected diff range", () => {
    expect(() =>
      parseReviewReport({
        content: JSON.stringify({
          summary: "Invalid finding.",
          findings: [
            {
              path: "src/new.ts",
              side: "new",
              startLine: 1,
              endLine: 1,
              code: "const other = input;",
              severity: "medium",
              title: "Check behavior",
              body: "The selected code does not match this range.",
              suggestion: "Copy the exact code from the diff.",
              replacementCode: "",
            },
          ],
        }),
        context: createContext(),
      }),
    ).toThrow(/Invalid review report: findings\.0 code does not match/);
  });

  it("accepts finding code when only whitespace differs from the selected range", () => {
    const report = parseReviewReport({
      content: JSON.stringify({
        summary: "Whitespace-only finding.",
        findings: [
          {
            path: "src/new.ts",
            side: "new",
            startLine: 10,
            endLine: 12,
            code: "if(enabled){run();}",
            severity: "medium",
            title: "Check compact copied code",
            body: "The copied code lost whitespace but still identifies the selected range.",
            suggestion: "Keep the anchor range.",
            replacementCode: "",
          },
        ],
      }),
      context: {
        ...createContext(),
        changedFiles: [
          {
            oldPath: "src/new.ts",
            newPath: "src/new.ts",
            diff: "@@ -10,0 +10,3 @@\n+if (enabled) {\n+  run();\n+}",
            newFile: false,
            renamedFile: false,
            deletedFile: false,
          },
        ],
      },
    });

    expect(report.findings[0]?.code).toBe("if(enabled){run();}");
  });

  it("suggests the exact diff range when mismatched code matches another range", () => {
    expect(() =>
      parseReviewReport({
        content: JSON.stringify({
          summary: "Invalid finding.",
          findings: [
            {
              path: "src/new.ts",
              side: "new",
              startLine: 10,
              endLine: 11,
              code: ["if (enabled) {", "  run();", "}"].join("\n"),
              severity: "medium",
              title: "Check block",
              body: "The selected code has one extra line.",
              suggestion: "Align the range with the copied code.",
              replacementCode: "",
            },
          ],
        }),
        context: {
          ...createContext(),
          changedFiles: [
            {
              oldPath: "src/new.ts",
              newPath: "src/new.ts",
              diff: "@@ -10,0 +10,3 @@\n+if (enabled) {\n+  run();\n+}",
              newFile: false,
              renamedFile: false,
              deletedFile: false,
            },
          ],
        },
      }),
    ).toThrow(
      /received code matches diff range for src\/new\.ts:10-12 \(new\)/,
    );
  });

  it("rejects legacy summaryFindings output", () => {
    expect(() =>
      parseReviewReport({
        content: JSON.stringify({
          summary: "Legacy report.",
          findings: [],
          summaryFindings: [
            {
              path: "src/helper.ts",
              side: "new",
              startLine: 12,
              endLine: 12,
              code: "helper(value);",
              severity: "medium",
              title: "Legacy finding",
              body: "This should now be in findings.",
              suggestion: "Return canonical findings only.",
              replacementCode: "",
            },
          ],
        }),
        context: createContext(),
      }),
    ).toThrow(
      /Invalid review report: <root>: Unrecognized key: "summaryFindings"/,
    );
  });

  it("keeps finding paths exactly as returned by the model", () => {
    const report = parseReviewReport({
      content: JSON.stringify({
        summary: "Renamed file finding.",
        findings: [
          {
            path: "src/old.ts",
            side: "new",
            startLine: 1,
            endLine: 1,
            code: "const value = input;",
            severity: "low",
            title: "Rename follow-up",
            body: "The renamed file has a minor issue.",
            suggestion: "Adjust the renamed file.",
            replacementCode: "",
          },
        ],
      }),
      context: createContext(),
    });

    expect(report.findings[0]?.path).toBe("src/old.ts");
  });

  it("extracts a single wrapped JSON report from explanatory text", () => {
    const report = parseReviewReport({
      content: [
        "Now I have enough context. Here is the final review JSON:",
        "```json",
        JSON.stringify({
          summary: "Wrapped JSON finding.",
          findings: [
            {
              path: "src/new.ts",
              side: "new",
              startLine: 1,
              endLine: 1,
              code: "const value = input;",
              severity: "high",
              title: "Validate input",
              body: "The new code trusts external input.",
              suggestion: "Validate the input before using it.",
              replacementCode: "",
            },
          ],
        }),
        "```",
      ].join("\n"),
      context: createContext(),
    });

    expect(report.summary).toBe("Wrapped JSON finding.");
    expect(report.findings).toHaveLength(1);
  });

  it("reports invalid JSON clearly", () => {
    expect(() =>
      parseReviewReport({
        content: "{",
        context: createContext(),
      }),
    ).toThrow(/Cannot parse review report JSON/);
  });

  it("reports invalid finding fields clearly", () => {
    expect(() =>
      parseReviewReport({
        content: JSON.stringify({
          summary: "Invalid finding.",
          findings: [
            {
              path: "src/new.ts",
              side: "new",
              startLine: 1,
              endLine: 1,
              code: "const value = input;",
              severity: "critical",
              title: "Invalid severity",
              body: "Severity is not supported.",
              suggestion: "Use a supported severity.",
              replacementCode: "",
            },
          ],
        }),
        context: createContext(),
      }),
    ).toThrow(/Invalid review report: findings\.0\.severity/);
  });

  it("rejects legacy single-line finding locations", () => {
    expect(() =>
      parseReviewReport({
        content: JSON.stringify({
          summary: "Legacy location.",
          findings: [
            {
              path: "src/new.ts",
              line: 1,
              severity: "high",
              title: "Validate input",
              body: "The new code trusts external input.",
              suggestion: "Validate the input before using it.",
              replacementCode: "",
            },
          ],
        }),
        context: createContext(),
      }),
    ).toThrow(/Invalid review report: findings\.0\.side/);
  });

  it("keeps duplicate finding locations exactly as returned by the model", () => {
    const report = parseReviewReport({
      content: JSON.stringify({
        summary: "Duplicated model finding.",
        findings: [
          {
            path: "src/old.ts",
            side: "new",
            startLine: 1,
            endLine: 1,
            code: "const value = input;",
            severity: "high",
            title: "Validate input",
            body: "The first explanation should be kept.",
            suggestion: "Validate the input before using it.",
            replacementCode: "",
          },
          {
            path: "src/new.ts",
            side: "new",
            startLine: 1,
            endLine: 1,
            code: "const value = input;",
            severity: "high",
            title: "Validate input again",
            body: "The duplicate explanation should be dropped.",
            suggestion: "Add a slightly different validation suggestion.",
            replacementCode: "",
          },
        ],
      }),
      context: createContext(),
    });

    expect(report.findings).toEqual([
      {
        path: "src/old.ts",
        side: "new",
        startLine: 1,
        endLine: 1,
        code: "const value = input;",
        severity: "high",
        title: "Validate input",
        body: "The first explanation should be kept.",
        suggestion: "Validate the input before using it.",
        replacementCode: "",
      },
      {
        path: "src/new.ts",
        side: "new",
        startLine: 1,
        endLine: 1,
        code: "const value = input;",
        severity: "high",
        title: "Validate input again",
        body: "The duplicate explanation should be dropped.",
        suggestion: "Add a slightly different validation suggestion.",
        replacementCode: "",
      },
    ]);
  });

  it("accepts deleted-line findings when the old-side code matches", () => {
    const report = parseReviewReport({
      content: JSON.stringify({
        summary: "Deleted finding.",
        findings: [
          {
            path: "src/new.ts",
            side: "old",
            startLine: 3,
            endLine: 3,
            code: "const removed = true;",
            severity: "medium",
            title: "Check deletion",
            body: "The removed line changed behavior.",
            suggestion: "Confirm the removal is intentional.",
            replacementCode: "",
          },
        ],
      }),
      context: {
        ...createContext(),
        changedFiles: [
          {
            oldPath: "src/new.ts",
            newPath: "src/new.ts",
            diff: "@@ -3,1 +3,0 @@\n-const removed = true;",
            newFile: false,
            renamedFile: false,
            deletedFile: false,
          },
        ],
      },
    });

    expect(report.findings).toHaveLength(1);
  });
});

function createContext(): GitLabMergeRequestContext {
  return {
    source: "gitlab-merge-request",
    gitlab: {
      apiUrl: "https://gitlab.example.test/api/v4",
      projectId: "123",
      mergeRequestIid: "42",
    },
    mergeRequest: {
      title: "Add review report",
      description: "Validate model findings.",
      diffRefs: {
        baseSha: "base-sha",
        startSha: "start-sha",
        headSha: "head-sha",
      },
    },
    changedFiles: [
      {
        oldPath: "src/old.ts",
        newPath: "src/new.ts",
        diff: "@@ -1,1 +1,2 @@\n+const value = input;\n const unchanged = true;",
        newFile: false,
        renamedFile: true,
        deletedFile: false,
      },
    ],
  };
}

function createPromptSummary() {
  return {
    extraRules: 0,
    totalBytes: 100,
    messages: [
      {
        role: "system" as const,
        bytes: 50,
      },
      {
        role: "user" as const,
        bytes: 50,
      },
    ],
  };
}
