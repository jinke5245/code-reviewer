import { describe, expect, it } from "vitest";

import type { ReviewPublicationPlan } from "../../src/gitlab/review-publication-plan.js";
import {
  createGitLabMergeRequestNoteClient,
  createSummaryNoteBody,
  createSummaryNoteFingerprint,
  publishMergeRequestSummaryNote,
  type GitLabMergeRequestNoteClient,
} from "../../src/gitlab/summary-note.js";
import {
  createGitLabRequestError,
  createGitLabSdkClient,
} from "./gitlab-sdk-test-utils.js";

describe("createSummaryNoteBody", () => {
  it("renders review overview, summary, findings, metadata, and a hidden fingerprint", () => {
    const plan = createPlan();
    const body = createSummaryNoteBody(plan);
    const fingerprint = createSummaryNoteFingerprint(plan);

    expect(body).toContain("## Code Reviewer");
    expect(body).toContain("### Review overview");
    expect(body).toContain("Reviewed commit: `head-sha`");
    expect(body).toContain("Changed files: 3");
    expect(body).toContain("Findings: 2");
    expect(body).toContain("Highest severity: high");
    expect(body).toContain("Inline findings: 1");
    expect(body).toContain("Unmapped findings: 1");
    expect(body).toContain(
      "Publish mode: inline (summary note plus inline discussions)",
    );
    expect(body).toContain("Found two issues.");
    expect(body).not.toContain("本次发布");
    expect(body).not.toContain("无法映射");
    expect(body).toContain("### Findings");
    expect(body).toContain("**[high] Validate input**");
    expect(body).toContain("`src/index.ts:7 (new)`");
    expect(body).not.toContain("const value = input;");
    expect(body).not.toContain("The new code trusts external input.");
    expect(body).not.toContain("Validate input before using it.");
    expect(body).not.toContain("General Findings");
    expect(body).toContain("Review architecture");
    expect(body).toContain("`src/service.ts:12-14 (new)`");
    expect(body).not.toContain("service.start();");
    expect(body).not.toContain("This concern is not tied to a stable diff position.");
    expect(body).not.toContain("Review the surrounding design.");
    expect(body).toContain("Tool calls: 1");
    expect(body).toContain("Prompt bytes: 120");
    expect(body).toContain(`<!-- codereviewer:summary:${fingerprint} -->`);
  });

  it("uses stable fingerprints for equivalent plans", () => {
    expect(createSummaryNoteFingerprint(createPlan())).toBe(
      createSummaryNoteFingerprint(createPlan()),
    );
  });

  it("does not include prompt or tool metadata in the summary fingerprint", () => {
    const plan = createPlan();
    const rerunPlan: ReviewPublicationPlan = {
      ...plan,
      promptSummary: {
        extraRules: 1,
        totalBytes: 180,
        messages: [
          {
            role: "system",
            bytes: 100,
          },
          {
            role: "user",
            bytes: 80,
          },
        ],
      },
      toolCalls: [
        {
          id: "call_rerun",
          name: "read_diff",
        },
      ],
    };

    expect(createSummaryNoteFingerprint(rerunPlan)).toBe(
      createSummaryNoteFingerprint(plan),
    );
  });

  it("uses stable summary fingerprints when wording changes", () => {
    const plan = createPlan();
    const rerunPlan: ReviewPublicationPlan = {
      ...plan,
      summary: "Same issues, different model summary.",
      inlineFindings: plan.inlineFindings.map((inlineFinding) => ({
        ...inlineFinding,
        finding: {
          ...inlineFinding.finding,
          title: "Different title",
          body: "Different explanation for the same anchored issue.",
          suggestion: "Different equivalent suggestion.",
          replacementCode: "",
        },
      })),
      unmappedFindings: plan.unmappedFindings.map((finding) => ({
        ...finding,
        title: "Different unmapped title",
        body: "Different explanation for the same unmapped issue.",
        suggestion: "Different unmapped suggestion.",
        replacementCode: "",
      })),
    };
    const changedSeverityPlan: ReviewPublicationPlan = {
      ...plan,
      findings: plan.findings.map((finding) => ({
        ...finding,
        severity:
          finding.title === "Validate input"
            ? "medium"
            : finding.severity,
      })),
      inlineFindings: plan.inlineFindings.map((inlineFinding) =>
        inlineFinding.finding.title === "Validate input"
          ? {
              ...inlineFinding,
              finding: {
                ...inlineFinding.finding,
                severity: "medium",
              },
            }
          : inlineFinding,
      ),
    };

    expect(createSummaryNoteFingerprint(rerunPlan)).toBe(
      createSummaryNoteFingerprint(plan),
    );
    expect(createSummaryNoteFingerprint(changedSeverityPlan)).not.toBe(
      createSummaryNoteFingerprint(plan),
    );
  });

  it("renders summary note bodies from a Markdown template", () => {
    const plan = createPlan();
    const body = createSummaryNoteBody(plan, {
      template: [
        "Summary: {{review.summary}}",
        "Commit: {{review.overview.commit}}",
        "Publish: {{review.overview.publishMode}} / {{review.overview.publishModeLabel}}",
        "Metadata: {{review.metadata.toolCalls}} / {{review.metadata.promptBytes}}",
        "",
        "{{#each review.findings}}",
        "{{number}}/{{index}} **[{{severityLabel}}] {{title}}**",
        "This location: {{this.location}}",
        "Location: `{{location}}`",
        "Raw: {{path}} {{side}} {{startLine}} {{endLine}}",
        "Body: {{body}}",
        "Suggestion: {{suggestion}}",
        "Code: {{code}}",
        "Replacement: {{replacementCode}}",
        "{{/each}}",
        "",
        "Unknown: {{review.typo}}",
      ].join("\n"),
    });
    const fingerprint = createSummaryNoteFingerprint(plan);

    expect(body).toContain("Summary: Found two issues.");
    expect(body).toContain("Commit: head-sha");
    expect(body).toContain(
      "Publish: inline / inline (summary note plus inline discussions)",
    );
    expect(body).toContain("Metadata: 1 / 120");
    expect(body).toContain("1/0 **[High] Validate input**");
    expect(body).toContain("This location: src/index.ts:7 (new)");
    expect(body).toContain("Location: `src/index.ts:7 (new)`");
    expect(body).toContain("Raw: src/index.ts new 7 7");
    expect(body).toContain("Body: The new code trusts external input.");
    expect(body).toContain("Suggestion: Validate input before using it.");
    expect(body).toContain("Code: const value = input;");
    expect(body).toContain("2/1 **[Medium] Review architecture**");
    expect(body).toContain("Location: `src/service.ts:12-14 (new)`");
    expect(body).toContain("Unknown: {{review.typo}}");
    expect(body).toContain(`<!-- codereviewer:summary:${fingerprint} -->`);
  });

  it("does not append a duplicate fingerprint when the summary template includes it", () => {
    const plan = createPlan();
    const fingerprint = createSummaryNoteFingerprint(plan);
    const body = createSummaryNoteBody(plan, {
      template: [
        "Summary: {{review.summary}}",
        "{{comment.fingerprint}}",
      ].join("\n"),
    });

    expect(body.match(/codereviewer:summary:/gu)).toHaveLength(1);
    expect(body).toContain(`<!-- codereviewer:summary:${fingerprint} -->`);
  });
});

describe("publishMergeRequestSummaryNote", () => {
  it("skips creating a note when the same fingerprint already exists", async () => {
    const plan = createPlan();
    const fingerprint = createSummaryNoteFingerprint(plan);
    const createdBodies: string[] = [];
    const client: GitLabMergeRequestNoteClient = {
      listMergeRequestNotes() {
        return Promise.resolve([
          {
            id: 10,
            body: `Existing note\n<!-- codereviewer:summary:${fingerprint} -->`,
          },
        ]);
      },
      createMergeRequestNote(_projectId, _mergeRequestIid, body) {
        createdBodies.push(body);
        return Promise.resolve({
          id: 11,
          body,
        });
      },
    };

    await expect(
      publishMergeRequestSummaryNote({
        client,
        projectId: "123",
        mergeRequestIid: "9",
        plan,
      }),
    ).resolves.toEqual({
      status: "skipped",
      fingerprint,
      existingNoteId: 10,
    });
    expect(createdBodies).toEqual([]);
  });

  it("skips creating a note when only prompt and tool metadata changed", async () => {
    const plan = createPlan();
    const fingerprint = createSummaryNoteFingerprint(plan);
    const createdBodies: string[] = [];
    const client: GitLabMergeRequestNoteClient = {
      listMergeRequestNotes() {
        return Promise.resolve([
          {
            id: 10,
            body: `Existing note\n<!-- codereviewer:summary:${fingerprint} -->`,
          },
        ]);
      },
      createMergeRequestNote(_projectId, _mergeRequestIid, body) {
        createdBodies.push(body);
        return Promise.resolve({
          id: 11,
          body,
        });
      },
    };

    const rerunPlan: ReviewPublicationPlan = {
      ...plan,
      toolCalls: [
        {
          id: "call_rerun",
          name: "read_diff",
        },
      ],
    };

    await expect(
      publishMergeRequestSummaryNote({
        client,
        projectId: "123",
        mergeRequestIid: "9",
        plan: rerunPlan,
      }),
    ).resolves.toMatchObject({
      status: "skipped",
      existingNoteId: 10,
    });
    expect(createdBodies).toEqual([]);
  });

  it("skips creating a note when only finding wording changed", async () => {
    const plan = createPlan();
    const fingerprint = createSummaryNoteFingerprint(plan);
    const createdBodies: string[] = [];
    const client: GitLabMergeRequestNoteClient = {
      listMergeRequestNotes() {
        return Promise.resolve([
          {
            id: 10,
            body: `Existing note\n<!-- codereviewer:summary:${fingerprint} -->`,
          },
        ]);
      },
      createMergeRequestNote(_projectId, _mergeRequestIid, body) {
        createdBodies.push(body);
        return Promise.resolve({
          id: 11,
          body,
        });
      },
    };
    const rerunPlan: ReviewPublicationPlan = {
      ...plan,
      summary: "Same issues, different model summary.",
      inlineFindings: plan.inlineFindings.map((inlineFinding) => ({
        ...inlineFinding,
        finding: {
          ...inlineFinding.finding,
          title: "Different title",
          body: "Different explanation for the same anchored issue.",
          suggestion: "Different equivalent suggestion.",
          replacementCode: "",
        },
      })),
    };

    await expect(
      publishMergeRequestSummaryNote({
        client,
        projectId: "123",
        mergeRequestIid: "9",
        plan: rerunPlan,
      }),
    ).resolves.toMatchObject({
      status: "skipped",
      existingNoteId: 10,
    });
    expect(createdBodies).toEqual([]);
  });

  it("creates a new summary note when the reviewed commit changed", async () => {
    const previousPlan = createNoFindingsPlan("previous-sha");
    const plan = createNoFindingsPlan("new-head-sha");
    const previousFingerprint = createSummaryNoteFingerprint(previousPlan);
    const createdBodies: string[] = [];
    const client: GitLabMergeRequestNoteClient = {
      listMergeRequestNotes() {
        return Promise.resolve([
          {
            id: 10,
            body: `Existing note\n<!-- codereviewer:summary:${previousFingerprint} -->`,
          },
        ]);
      },
      createMergeRequestNote(_projectId, _mergeRequestIid, body) {
        createdBodies.push(body);
        return Promise.resolve({
          id: 11,
          body,
        });
      },
    };

    await expect(
      publishMergeRequestSummaryNote({
        client,
        projectId: "123",
        mergeRequestIid: "9",
        plan,
      }),
    ).resolves.toEqual({
      status: "created",
      fingerprint: createSummaryNoteFingerprint(plan),
      noteId: 11,
    });
    expect(createdBodies).toHaveLength(1);
    expect(createdBodies[0]).toContain("Reviewed commit: `new-head-sha`");
  });

  it("creates a summary note when no matching fingerprint exists", async () => {
    const plan = createPlan();
    const createdBodies: string[] = [];
    const client: GitLabMergeRequestNoteClient = {
      listMergeRequestNotes() {
        return Promise.resolve([]);
      },
      createMergeRequestNote(_projectId, _mergeRequestIid, body) {
        createdBodies.push(body);
        return Promise.resolve({
          id: 11,
          body,
          webUrl: "https://gitlab.example.test/note/11",
        });
      },
    };

    await expect(
      publishMergeRequestSummaryNote({
        client,
        projectId: "123",
        mergeRequestIid: "9",
        plan,
      }),
    ).resolves.toEqual({
      status: "created",
      fingerprint: createSummaryNoteFingerprint(plan),
      noteId: 11,
      noteUrl: "https://gitlab.example.test/note/11",
    });
    expect(createdBodies).toHaveLength(1);
    expect(createdBodies[0]).toContain("## Code Reviewer");
  });
});

describe("createGitLabMergeRequestNoteClient", () => {
  it("lists and creates merge request notes with GitBeaker", async () => {
    const calls: string[] = [];
    const client = createGitLabMergeRequestNoteClient({
      apiUrl: "https://gitlab.example.test/api/v4/",
      token: "secret-token",
      gitlab: createGitLabSdkClient({
        MergeRequestNotes: {
          all(projectId, mergeRequestIid, options) {
            calls.push(
              `all:${String(projectId)}:${String(mergeRequestIid)}:${String(options?.perPage)}`,
            );
            return Promise.resolve([
              {
                id: 10,
                body: "Existing note",
                web_url: "https://gitlab.example.test/note/10",
              },
            ]);
          },
          create(projectId, mergeRequestIid, body) {
            calls.push(
              `create:${String(projectId)}:${String(mergeRequestIid)}:${body}`,
            );
            return Promise.resolve({
              id: 11,
              body: "Created note",
              web_url: "https://gitlab.example.test/note/11",
            });
          },
        },
      }),
    });

    await expect(
      client.listMergeRequestNotes("group/project", "7"),
    ).resolves.toEqual([
      {
        id: 10,
        body: "Existing note",
        webUrl: "https://gitlab.example.test/note/10",
      },
    ]);
    await expect(
      client.createMergeRequestNote("group/project", "7", "Created note"),
    ).resolves.toEqual({
      id: 11,
      body: "Created note",
      webUrl: "https://gitlab.example.test/note/11",
    });
    expect(calls).toEqual([
      "all:group/project:7:100",
      "create:group/project:7:Created note",
    ]);
  });

  it("reports GitLab note API failures clearly", async () => {
    const client = createGitLabMergeRequestNoteClient({
      apiUrl: "https://gitlab.example.test/api/v4",
      token: "bad-token",
      gitlab: createGitLabSdkClient({
        MergeRequestNotes: {
          all() {
            return Promise.reject(
              createGitLabRequestError({
                url: "https://gitlab.example.test/api/v4/projects/123/merge_requests/9/notes",
                status: 403,
                statusText: "Forbidden",
              }),
            );
          },
        },
      }),
    });

    await expect(client.listMergeRequestNotes("123", "9")).rejects.toThrow(
      /GitLab notes API request failed: 403 Forbidden .*merge_requests\/9\/notes/,
    );
  });
});

function createPlan(): ReviewPublicationPlan {
  return {
    overview: {
      commit: "head-sha",
      changedFiles: 3,
      findings: 2,
      highestSeverity: "high",
      inlineFindings: 1,
      unmappedFindings: 1,
      publishMode: "inline",
    },
    summary: "Found two issues.",
    findings: [
      {
        path: "src/index.ts",
        side: "new",
        startLine: 7,
        endLine: 7,
        code: "const value = input;",
        severity: "high",
        title: "Validate input",
        body: "The new code trusts external input.",
        suggestion: "Validate input before using it.",
        replacementCode: "",
      },
      {
        path: "src/service.ts",
        side: "new",
        startLine: 12,
        endLine: 14,
        code: "service.start();\nservice.run();\nservice.stop();",
        severity: "medium",
        title: "Review architecture",
        body: "This concern is not tied to a stable diff position.",
        suggestion: "Review the surrounding design.",
        replacementCode: "",
      },
    ],
    inlineFindings: [
      {
        finding: {
          path: "src/index.ts",
          side: "new",
          startLine: 7,
          endLine: 7,
          code: "const value = input;",
          severity: "high",
          title: "Validate input",
          body: "The new code trusts external input.",
          suggestion: "Validate input before using it.",
          replacementCode: "",
        },
        position: {
          positionType: "text",
          baseSha: "base-sha",
          startSha: "start-sha",
          headSha: "head-sha",
          oldPath: "src/index.ts",
          newPath: "src/index.ts",
          newLine: 7,
        },
      },
    ],
    unmappedFindings: [
      {
        path: "src/service.ts",
        side: "new",
        startLine: 12,
        endLine: 14,
        code: "service.start();\nservice.run();\nservice.stop();",
        severity: "medium",
        title: "Review architecture",
        body: "This concern is not tied to a stable diff position.",
        suggestion: "Review the surrounding design.",
        replacementCode: "",
      },
    ],
    promptSummary: {
      extraRules: 1,
      totalBytes: 120,
      messages: [
        {
          role: "system",
          bytes: 60,
        },
        {
          role: "user",
          bytes: 60,
        },
      ],
    },
    toolCalls: [
      {
        id: "call_1",
        name: "read_diff",
      },
    ],
  };
}

function createNoFindingsPlan(commit: string): ReviewPublicationPlan {
  const plan = createPlan();

  return {
    ...plan,
    overview: {
      ...plan.overview,
      commit,
      findings: 0,
      highestSeverity: "none",
      inlineFindings: 0,
      unmappedFindings: 0,
    },
    summary: "No findings.",
    findings: [],
    inlineFindings: [],
    unmappedFindings: [],
  };
}
