import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { main } from "../../src/cli.js";
import type { ReviewModel } from "../../src/review/loop.js";

type RecordedRequest = {
  url: string;
  privateToken: string | null;
  authorization?: string | null;
  method?: string;
  body?: unknown;
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("review dry-run integration", () => {
  it("loads config, reads GitLab MR context, and prints dry-run JSON", async () => {
    const requests: RecordedRequest[] = [];
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-integration-"));
    const configPath = join(cwd, ".codereviewer.yml");
    const stdout: string[] = [];
    const reviewModel: ReviewModel = {
      complete() {
        return Promise.resolve({
          content: JSON.stringify({
            summary: "Integration review complete.",
            findings: [
              {
                path: "src/new.ts",
                side: "new",
                startLine: 1,
                endLine: 1,
                code: "export const reviewed = true;",
                severity: "low",
                title: "Add a test",
                body: "The new behavior should have a regression test.",
                suggestion: "Add a focused unit test for the new export.",
                replacementCode: "",
              },
            ],
          }),
        });
      },
    };

    const fetchMock: typeof fetch = async (input, init) => {
      const request = await recordRequest(requests, input, init);
      const url = request.url;

      if (isGitLabApiPath(url, "/projects/123/merge_requests/9")) {
        return Promise.resolve(
          jsonResponse({
            title: "Add integration test",
            description: "Verify dry-run review context collection.",
            diff_refs: {
              base_sha: "base-sha",
              start_sha: "start-sha",
              head_sha: "head-sha",
            },
          }),
        );
      }

      if (isGitLabApiPath(url, "/projects/123/merge_requests/9/diffs")) {
        return Promise.resolve(
          jsonResponse([
            {
              old_path: "src/old.ts",
              new_path: "src/new.ts",
              diff: "@@ -0,0 +1,1 @@\n+export const reviewed = true;",
              new_file: false,
              renamed_file: true,
              deleted_file: false,
            },
          ]),
        );
      }

      return Promise.resolve(
        new Response("not found", {
          status: 404,
          statusText: "Not Found",
        }),
      );
    };

    globalThis.fetch = vi.fn(fetchMock);

    await mkdir(join(cwd, ".codereviewer", "templates"), {
      recursive: true,
    });
    await writeFile(
      join(cwd, ".codereviewer", "templates", "summary.md"),
      [
        "Custom summary: {{review.summary}}",
        "Findings: {{review.overview.findings}}",
        "{{comment.fingerprint}}",
        "",
      ].join("\n"),
    );
    await writeFile(
      configPath,
      [
        "gitlab:",
        "  tokenEnv: REVIEW_TOKEN",
        "  publish: summary",
        "templates:",
        "  summary: .codereviewer/templates/summary.md",
        "",
      ].join("\n"),
    );

    await main(["node", "codereviewer", "review", "--dry-run"], {
      cwd,
      env: {
        CI_API_V4_URL: "https://gitlab.example.test/api/v4",
        CI_PROJECT_ID: "123",
        CI_MERGE_REQUEST_IID: "9",
        REVIEW_TOKEN: "secret-token",
      },
      reviewModel,
      stdout: (text) => stdout.push(text),
    });

    const output = JSON.parse(stdout.join("\n")) as {
      command: string;
      dryRun: boolean;
      report: {
        summary: string;
        findings: Array<{
          path: string;
          side: string;
          startLine: number;
          endLine: number;
          code: string;
          severity: string;
          title: string;
          body: string;
          suggestion: string;
        }>;
        promptSummary: {
          totalBytes: number;
        };
      };
    };

    expect(output.command).toBe("review");
    expect(output.dryRun).toBe(true);
    expect(output.report).toMatchObject({
      summary: "Integration review complete.",
      findings: [
        {
          path: "src/new.ts",
          side: "new",
          startLine: 1,
          endLine: 1,
          code: "export const reviewed = true;",
          severity: "low",
          title: "Add a test",
          body: "The new behavior should have a regression test.",
          suggestion: "Add a focused unit test for the new export.",
          replacementCode: "",
        },
      ],
    });
    expect(output.report.promptSummary.totalBytes).toBeGreaterThan(0);
    expect(output.report.findings).toEqual([
      {
        path: "src/new.ts",
        side: "new",
        startLine: 1,
        endLine: 1,
        code: "export const reviewed = true;",
        severity: "low",
        title: "Add a test",
        body: "The new behavior should have a regression test.",
        suggestion: "Add a focused unit test for the new export.",
        replacementCode: "",
      },
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      url: "https://gitlab.example.test/api/v4/projects/123/merge_requests/9",
      privateToken: "secret-token",
    });
    expect(requests[1]).toMatchObject({
      privateToken: "secret-token",
    });
    expect(requests[1]?.url).toContain(
      "https://gitlab.example.test/api/v4/projects/123/merge_requests/9/diffs",
    );
    expect(new URL(requests[1]?.url ?? "").searchParams.get("per_page")).toBe(
      "100",
    );
  });

  it("uses OpenAI-compatible environment variables in the CLI review path", async () => {
    const requests: RecordedRequest[] = [];
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-integration-"));
    const configPath = join(cwd, ".codereviewer.yml");
    const stdout: string[] = [];

    const fetchMock: typeof fetch = async (input, init) => {
      const request = await recordRequest(requests, input, init);
      const url = request.url;

      if (isGitLabApiPath(url, "/projects/123/merge_requests/9")) {
        return Promise.resolve(
          jsonResponse({
            title: "Add OpenAI env integration",
            description: "Verify model construction from env.",
            diff_refs: {
              base_sha: "base-sha",
              start_sha: "start-sha",
              head_sha: "head-sha",
            },
          }),
        );
      }

      if (isGitLabApiPath(url, "/projects/123/merge_requests/9/diffs")) {
        return Promise.resolve(
          jsonResponse([
            {
              old_path: "src/new.ts",
              new_path: "src/new.ts",
              diff: "@@ -1,1 +1,1 @@\n-export const value = false;\n+export const value = true;",
              new_file: false,
              renamed_file: false,
              deleted_file: false,
            },
          ]),
        );
      }

      if (url === "https://model.example.test/v1/chat/completions") {
        return Promise.resolve(
          jsonResponse({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "Environment-backed model review complete.",
                    findings: [],
                  }),
                },
              },
            ],
          }),
        );
      }

      return Promise.resolve(
        new Response("not found", {
          status: 404,
          statusText: "Not Found",
        }),
      );
    };

    globalThis.fetch = vi.fn(fetchMock);

    await writeFile(
      configPath,
      ["gitlab:", "  tokenEnv: REVIEW_TOKEN", "  publish: dry-run", ""].join(
        "\n",
      ),
    );

    await main(["node", "codereviewer", "review"], {
      cwd,
      env: {
        CI_API_V4_URL: "https://gitlab.example.test/api/v4",
        CI_PROJECT_ID: "123",
        CI_MERGE_REQUEST_IID: "9",
        REVIEW_TOKEN: "secret-token",
        OPENAI_API_KEY: "openai-secret",
        OPENAI_BASE_URL: "https://model.example.test/v1///",
        OPENAI_MODEL: "gpt-env",
      },
      stdout: (text) => stdout.push(text),
    });

    const modelRequest = requests.find((request) =>
      request.url.endsWith("/chat/completions"),
    );
    const finalModelRequest = requests
      .filter(isOpenAIChatCompletionRequest)
      .at(-1);
    const modelRequestBody = readPostedRequestBody(modelRequest);
    const finalModelRequestBody = readPostedRequestBody(finalModelRequest);
    const output = JSON.parse(stdout.join("\n")) as {
      dryRun: boolean;
      report: {
        summary: string;
        findings: unknown[];
      };
    };

    expect(modelRequest).toMatchObject({
      url: "https://model.example.test/v1/chat/completions",
      authorization: "Bearer openai-secret",
      method: "POST",
    });
    expect(modelRequestBody).toMatchObject({
      model: "gpt-env",
      tool_choice: "auto",
    });
    expect(modelRequestBody).toHaveProperty("messages");
    expect(
      readToolParameter(modelRequestBody, "read_gitlab_issue", "iid"),
    ).toMatchObject({
      type: "integer",
      minimum: 1,
    });
    const readIssueTool = readToolDefinition(
      modelRequestBody,
      "read_gitlab_issue",
    );
    const readIssueParameters = readRecordValue(
      readRecordValue(readIssueTool, "function"),
      "parameters",
    );

    expect(readIssueParameters).toMatchObject({
      anyOf: [{ required: ["iid"] }, { required: ["reference"] }],
    });
    expect(
      readToolParameter(modelRequestBody, "read_gitlab_mr", "iid"),
    ).toMatchObject({
      type: "integer",
      minimum: 1,
    });
    expect(
      readToolParameter(modelRequestBody, "list_gitlab_issues", "limit"),
    ).toMatchObject({
      type: "integer",
      minimum: 1,
      maximum: 100,
    });
    expect(
      readToolParameter(modelRequestBody, "list_gitlab_mrs", "limit"),
    ).toMatchObject({
      type: "integer",
      minimum: 1,
      maximum: 100,
    });
    expect(readToolNames(modelRequestBody)).not.toContain("read_github_pr");
    expect(readToolNames(modelRequestBody)).not.toContain(
      "read_github_pr_comments",
    );
    expect(finalModelRequestBody.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "code_reviewer_report",
        strict: true,
      },
    });
    expect(finalModelRequestBody).not.toHaveProperty("tools");
    expect(finalModelRequestBody).not.toHaveProperty("tool_choice");
    expect(output).toMatchObject({
      dryRun: true,
      report: {
        summary: "Environment-backed model review complete.",
        findings: [],
      },
    });
  });

  it("does not advertise tools denied by configured permissions", async () => {
    const requests: RecordedRequest[] = [];
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-integration-"));
    const configPath = join(cwd, ".codereviewer.yml");
    const stdout: string[] = [];

    const fetchMock: typeof fetch = async (input, init) => {
      const request = await recordRequest(requests, input, init);
      const url = request.url;

      if (isGitLabApiPath(url, "/projects/123/merge_requests/9")) {
        return Promise.resolve(
          jsonResponse({
            title: "Disable tools",
            description: "Verify permission filtering.",
            diff_refs: {
              base_sha: "base-sha",
              start_sha: "start-sha",
              head_sha: "head-sha",
            },
          }),
        );
      }

      if (isGitLabApiPath(url, "/projects/123/merge_requests/9/diffs")) {
        return Promise.resolve(
          jsonResponse([
            {
              old_path: "src/new.ts",
              new_path: "src/new.ts",
              diff: "@@ -1,1 +1,1 @@\n-export const value = false;\n+export const value = true;",
              new_file: false,
              renamed_file: false,
              deleted_file: false,
            },
          ]),
        );
      }

      if (url === "https://model.example.test/v1/chat/completions") {
        return Promise.resolve(
          jsonResponse({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "Permission-filtered model review complete.",
                    findings: [],
                  }),
                },
              },
            ],
          }),
        );
      }

      return Promise.resolve(
        new Response("not found", {
          status: 404,
          statusText: "Not Found",
        }),
      );
    };

    globalThis.fetch = vi.fn(fetchMock);

    await writeFile(
      configPath,
      [
        "gitlab:",
        "  tokenEnv: REVIEW_TOKEN",
        "  publish: dry-run",
        "tools:",
        "  permissions:",
        "    readRepo: false",
        "    readGitLab: false",
        "    readPlatform: false",
        "",
      ].join("\n"),
    );

    await main(["node", "codereviewer", "review"], {
      cwd,
      env: {
        CI_API_V4_URL: "https://gitlab.example.test/api/v4",
        CI_PROJECT_ID: "123",
        CI_MERGE_REQUEST_IID: "9",
        REVIEW_TOKEN: "secret-token",
        OPENAI_API_KEY: "openai-secret",
        OPENAI_BASE_URL: "https://model.example.test/v1",
        OPENAI_MODEL: "gpt-env",
      },
      stdout: (text) => stdout.push(text),
    });

    const modelRequest = requests.find((request) =>
      request.url.endsWith("/chat/completions"),
    );
    const modelRequestBody = readPostedRequestBody(modelRequest);

    expect(modelRequestBody).not.toHaveProperty("tools");
    expect(modelRequestBody).not.toHaveProperty("tool_choice");
  });

  it("repairs non-JSON OpenAI-compatible report output before printing dry-run JSON", async () => {
    const requests: RecordedRequest[] = [];
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-integration-"));
    const configPath = join(cwd, ".codereviewer.yml");
    const stdout: string[] = [];
    const stderr: string[] = [];

    globalThis.fetch = vi.fn(
      createOpenAICompatibleReviewHarnessFetch({
        requests,
        modelContents: [
          "I have enough context to write the report.",
          "This is prose even though response_format asked for JSON.",
          JSON.stringify({
            summary: "Repaired model report.",
            findings: [],
          }),
        ],
      }),
    );

    await writeFile(
      configPath,
      ["gitlab:", "  tokenEnv: REVIEW_TOKEN", "  publish: dry-run", ""].join(
        "\n",
      ),
    );

    await main(["node", "codereviewer", "review"], {
      cwd,
      env: {
        CI_API_V4_URL: "https://gitlab.example.test/api/v4",
        CI_PROJECT_ID: "123",
        CI_MERGE_REQUEST_IID: "9",
        REVIEW_TOKEN: "secret-token",
        OPENAI_API_KEY: "openai-secret",
        OPENAI_BASE_URL: "https://model.example.test/v1",
        OPENAI_MODEL: "gpt-env",
      },
      stderr: (text) => stderr.push(text),
      stdout: (text) => stdout.push(text),
    });

    const modelRequests = requests.filter(isOpenAIChatCompletionRequest);
    const structuredModelRequests = modelRequests.filter((request) =>
      Object.hasOwn(readPostedRequestBody(request), "response_format"),
    );
    const output = JSON.parse(stdout.join("\n")) as {
      dryRun: boolean;
      report: {
        summary: string;
        findings: unknown[];
      };
    };

    expect(modelRequests).toHaveLength(3);
    expect(structuredModelRequests).toHaveLength(2);
    expect(output).toMatchObject({
      dryRun: true,
      report: {
        summary: "Repaired model report.",
        findings: [],
      },
    });
    expect(stderr).toEqual(
      expect.arrayContaining([
        expect.stringContaining("repair phase attempt 1/3"),
      ]),
    );
  });

  it("fails after repeated non-JSON OpenAI-compatible report output without printing dry-run JSON", async () => {
    const requests: RecordedRequest[] = [];
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-integration-"));
    const configPath = join(cwd, ".codereviewer.yml");
    const stdout: string[] = [];
    const stderr: string[] = [];

    globalThis.fetch = vi.fn(
      createOpenAICompatibleReviewHarnessFetch({
        requests,
        modelContents: [
          "I have enough context to write the report.",
          "This is not JSON.",
          "Still not JSON.",
          "Still not JSON again.",
          "Still not JSON after every repair.",
        ],
      }),
    );

    await writeFile(
      configPath,
      ["gitlab:", "  tokenEnv: REVIEW_TOKEN", "  publish: dry-run", ""].join(
        "\n",
      ),
    );

    await expect(
      main(["node", "codereviewer", "review"], {
        cwd,
        env: {
          CI_API_V4_URL: "https://gitlab.example.test/api/v4",
          CI_PROJECT_ID: "123",
          CI_MERGE_REQUEST_IID: "9",
          REVIEW_TOKEN: "secret-token",
          OPENAI_API_KEY: "openai-secret",
          OPENAI_BASE_URL: "https://model.example.test/v1",
          OPENAI_MODEL: "gpt-env",
        },
        stderr: (text) => stderr.push(text),
        stdout: (text) => stdout.push(text),
      }),
    ).rejects.toThrow(/Cannot parse review report JSON/);

    const modelRequests = requests.filter(isOpenAIChatCompletionRequest);
    const structuredModelRequests = modelRequests.filter((request) =>
      Object.hasOwn(readPostedRequestBody(request), "response_format"),
    );

    expect(stdout).toEqual([]);
    expect(modelRequests).toHaveLength(5);
    expect(structuredModelRequests).toHaveLength(4);
    expect(stderr).toEqual(
      expect.arrayContaining([
        expect.stringContaining("repair phase attempt 3/3"),
      ]),
    );
  });

  it("publishes a merge request summary note when configured", async () => {
    const requests: RecordedRequest[] = [];
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-integration-"));
    const configPath = join(cwd, ".codereviewer.yml");
    const stdout: string[] = [];
    const reviewModel: ReviewModel = {
      complete() {
        return Promise.resolve({
          content: JSON.stringify({
            summary: "Publishable review complete.",
            findings: [
              {
                path: "src/new.ts",
                side: "new",
                startLine: 1,
                endLine: 1,
                code: "export const reviewed = true;",
                severity: "medium",
                title: "Add coverage",
                body: "The new export needs coverage.",
                suggestion: "Add a unit test for the export.",
                replacementCode: "",
              },
            ],
          }),
        });
      },
    };

    const fetchMock: typeof fetch = async (input, init) => {
      const request = await recordRequest(requests, input, init);
      const url = request.url;

      if (isGitLabApiPath(url, "/projects/123/merge_requests/9")) {
        return Promise.resolve(
          jsonResponse({
            title: "Add integration test",
            description: "Verify summary publishing.",
            diff_refs: {
              base_sha: "base-sha",
              start_sha: "start-sha",
              head_sha: "head-sha",
            },
          }),
        );
      }

      if (isGitLabApiPath(url, "/projects/123/merge_requests/9/diffs")) {
        return Promise.resolve(
          jsonResponse([
            {
              old_path: "src/old.ts",
              new_path: "src/new.ts",
              diff: "@@ -0,0 +1,1 @@\n+export const reviewed = true;",
              new_file: false,
              renamed_file: true,
              deleted_file: false,
            },
          ]),
        );
      }

      if (
        isGitLabApiPath(url, "/projects/123/merge_requests/9/notes") &&
        request.method === undefined
      ) {
        return Promise.resolve(jsonResponse([]));
      }

      if (
        isGitLabApiPath(url, "/projects/123/merge_requests/9/notes") &&
        request.method === "POST"
      ) {
        return Promise.resolve(
          jsonResponse({
            id: 55,
            body: "created",
            web_url: "https://gitlab.example.test/note/55",
          }),
        );
      }

      return Promise.resolve(
        new Response("not found", {
          status: 404,
          statusText: "Not Found",
        }),
      );
    };

    globalThis.fetch = vi.fn(fetchMock);

    await mkdir(join(cwd, ".codereviewer", "templates"), {
      recursive: true,
    });
    await writeFile(
      join(cwd, ".codereviewer", "templates", "summary.md"),
      [
        "Custom summary: {{review.summary}}",
        "Findings: {{review.overview.findings}}",
        "{{comment.fingerprint}}",
        "",
      ].join("\n"),
    );
    await writeFile(
      configPath,
      [
        "gitlab:",
        "  tokenEnv: REVIEW_TOKEN",
        "  publish: summary",
        "templates:",
        "  summary: .codereviewer/templates/summary.md",
        "",
      ].join("\n"),
    );

    await main(["node", "codereviewer", "review"], {
      cwd,
      env: {
        CI_API_V4_URL: "https://gitlab.example.test/api/v4",
        CI_PROJECT_ID: "123",
        CI_MERGE_REQUEST_IID: "9",
        REVIEW_TOKEN: "secret-token",
      },
      reviewModel,
      stdout: (text) => stdout.push(text),
    });

    const output = JSON.parse(stdout.join("\n")) as {
      dryRun: boolean;
      publish: {
        status: string;
        noteId: number;
        noteUrl: string;
        fingerprint: string;
      };
    };
    const postRequest = requests.find((request) => request.method === "POST");

    expect(output.dryRun).toBe(false);
    expect(output.publish).toMatchObject({
      status: "created",
      noteId: 55,
      noteUrl: "https://gitlab.example.test/note/55",
    });
    expect(output.publish.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const noteBody = readPostedNoteBody(postRequest);

    expect(noteBody).toContain("Custom summary: Publishable review complete.");
    expect(noteBody).toContain("Findings: 1");
    expect(noteBody).not.toContain("## Code Reviewer");
    expect(noteBody).toContain("<!-- codereviewer:summary:");
  });

  it("publishes inline discussions when configured", async () => {
    const requests: RecordedRequest[] = [];
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-integration-"));
    const configPath = join(cwd, ".codereviewer.yml");
    const stdout: string[] = [];
    const reviewModel: ReviewModel = {
      complete() {
        return Promise.resolve({
          content: JSON.stringify({
            summary: "Inline review complete.",
            findings: [
              {
                path: "src/new.ts",
                side: "new",
                startLine: 1,
                endLine: 1,
                code: "export const reviewed = true;",
                severity: "high",
                title: "Validate exported value",
                body: "The exported value needs validation.",
                suggestion: "Validate the value before exporting it.",
                replacementCode: "",
              },
            ],
          }),
        });
      },
    };

    const fetchMock: typeof fetch = async (input, init) => {
      const request = await recordRequest(requests, input, init);
      const url = request.url;

      if (isGitLabApiPath(url, "/projects/123/merge_requests/9")) {
        return Promise.resolve(
          jsonResponse({
            title: "Add inline discussion",
            description: "Verify inline publishing.",
            diff_refs: {
              base_sha: "base-sha",
              start_sha: "start-sha",
              head_sha: "head-sha",
            },
          }),
        );
      }

      if (isGitLabApiPath(url, "/projects/123/merge_requests/9/diffs")) {
        return Promise.resolve(
          jsonResponse([
            {
              old_path: "src/old.ts",
              new_path: "src/new.ts",
              diff: "@@ -0,0 +1,1 @@\n+export const reviewed = true;",
              new_file: false,
              renamed_file: true,
              deleted_file: false,
            },
          ]),
        );
      }

      if (
        isGitLabApiPath(url, "/projects/123/merge_requests/9/discussions") &&
        request.method === undefined
      ) {
        return Promise.resolve(jsonResponse([]));
      }

      if (
        isGitLabApiPath(url, "/projects/123/merge_requests/9/notes") &&
        request.method === undefined
      ) {
        return Promise.resolve(jsonResponse([]));
      }

      if (
        isGitLabApiPath(url, "/projects/123/merge_requests/9/notes") &&
        request.method === "POST"
      ) {
        return Promise.resolve(
          jsonResponse({
            id: 78,
            body: "summary created",
            web_url: "https://gitlab.example.test/note/78",
          }),
        );
      }

      if (
        isGitLabApiPath(url, "/projects/123/merge_requests/9/discussions") &&
        request.method === "POST"
      ) {
        return Promise.resolve(
          jsonResponse({
            id: "discussion-1",
            notes: [
              {
                id: 77,
                body: "created",
                web_url: "https://gitlab.example.test/discussion/1",
              },
            ],
          }),
        );
      }

      return Promise.resolve(
        new Response("not found", {
          status: 404,
          statusText: "Not Found",
        }),
      );
    };

    globalThis.fetch = vi.fn(fetchMock);

    await mkdir(join(cwd, ".codereviewer", "templates"), {
      recursive: true,
    });
    await writeFile(
      join(cwd, ".codereviewer", "templates", "summary.md"),
      [
        "Inline summary: {{review.summary}}",
        "{{comment.fingerprint}}",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(cwd, ".codereviewer", "templates", "inline.md"),
      [
        "Custom inline: {{finding.title}}",
        "Impact: {{comment.severityLabel}}",
        "{{comment.fingerprint}}",
        "",
      ].join("\n"),
    );
    await writeFile(
      configPath,
      [
        "gitlab:",
        "  tokenEnv: REVIEW_TOKEN",
        "  publish: inline",
        "templates:",
        "  summary: .codereviewer/templates/summary.md",
        "  inline: .codereviewer/templates/inline.md",
        "",
      ].join("\n"),
    );

    await main(["node", "codereviewer", "review"], {
      cwd,
      env: {
        CI_API_V4_URL: "https://gitlab.example.test/api/v4",
        CI_PROJECT_ID: "123",
        CI_MERGE_REQUEST_IID: "9",
        REVIEW_TOKEN: "secret-token",
      },
      reviewModel,
      stdout: (text) => stdout.push(text),
    });

    const output = JSON.parse(stdout.join("\n")) as {
      dryRun: boolean;
      publish: {
        mode: string;
        created: number;
        skipped: number;
        unpublished: number;
      };
    };
    const postRequest = requests.find(
      (request) =>
        request.method === "POST" && request.url.endsWith("/discussions"),
    );
    const noteRequest = requests.find(
      (request) => request.method === "POST" && request.url.endsWith("/notes"),
    );
    const postBody = readPostedRequestBody(postRequest);
    const discussionBody = readStringRecordValue(postBody, "body");
    const noteBody = readPostedNoteBody(noteRequest);

    expect(output.dryRun).toBe(false);
    expect(output.publish).toMatchObject({
      mode: "inline",
      created: 1,
      skipped: 0,
      unpublished: 0,
    });
    expect(
      requests
        .filter((request) => request.method === "POST")
        .map((request) => new URL(request.url).pathname),
    ).toEqual([
      "/api/v4/projects/123/merge_requests/9/notes",
      "/api/v4/projects/123/merge_requests/9/discussions",
    ]);
    const normalizedDiscussionBody = discussionBody
      .replace(/\r\n/gu, "\n")
      .trimEnd();

    expect(normalizedDiscussionBody).toMatch(
      /^Custom inline: Validate exported value\nImpact: High\n<!-- codereviewer:inline:[a-f0-9]{64} -->$/u,
    );
    expect(normalizedDiscussionBody).not.toContain("**Issue:**");
    expect(noteBody).toContain("Inline summary: Inline review complete.");
    expect(noteBody).not.toContain("## Code Reviewer");
    expect(postBody).toMatchObject({
      position: {
        position_type: "text",
        base_sha: "base-sha",
        start_sha: "start-sha",
        head_sha: "head-sha",
        old_path: "src/old.ts",
        new_path: "src/new.ts",
        new_line: 1,
      },
    });
  });

  it("advertises only GitHub platform tools for GitHub provider model requests", async () => {
    const requests: RecordedRequest[] = [];
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-integration-"));
    const configPath = join(cwd, ".codereviewer.yml");
    const eventPath = join(cwd, "github-event.json");
    const stdout: string[] = [];

    globalThis.fetch = vi.fn(
      createGitHubReviewFetch({
        modelContent: JSON.stringify({
          summary: "Environment-backed GitHub review complete.",
          findings: [],
        }),
        requests,
      }),
    );

    await writeFile(
      eventPath,
      JSON.stringify({ pull_request: { number: 12 } }),
    );
    await writeFile(
      configPath,
      [
        "provider: github",
        "github:",
        "  tokenEnv: REVIEW_TOKEN",
        "  publish: dry-run",
        "",
      ].join("\n"),
    );

    await main(["node", "codereviewer", "review"], {
      cwd,
      env: {
        ...createGitHubEnv(eventPath),
        OPENAI_API_KEY: "openai-secret",
        OPENAI_BASE_URL: "https://model.example.test/v1",
        OPENAI_MODEL: "gpt-env",
      },
      stdout: (text) => stdout.push(text),
    });

    const modelRequest = requests.find((request) =>
      request.url.endsWith("/chat/completions"),
    );
    const modelRequestBody = readPostedRequestBody(modelRequest);
    const output = JSON.parse(stdout.join("\n")) as {
      report: {
        summary: string;
      };
    };

    expect(readToolNames(modelRequestBody)).toEqual([
      "read_diff",
      "read_file",
      "repo_search",
      "read_github_pr",
      "read_github_pr_comments",
    ]);
    expect(output.report.summary).toBe(
      "Environment-backed GitHub review complete.",
    );
  });

  it("loads GitHub PR context and prints dry-run JSON", async () => {
    const requests: RecordedRequest[] = [];
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-integration-"));
    const configPath = join(cwd, ".codereviewer.yml");
    const eventPath = join(cwd, "github-event.json");
    const stdout: string[] = [];

    globalThis.fetch = vi.fn(createGitHubReviewFetch({ requests }));

    await mkdir(join(cwd, ".github", "REVIEW_TEMPLATES"), {
      recursive: true,
    });
    await writeFile(
      join(cwd, ".github", "REVIEW_TEMPLATES", "summary.md"),
      [
        "GitHub summary template: {{review.summary}}",
        "{{comment.fingerprint}}",
        "",
      ].join("\n"),
    );
    await writeFile(
      eventPath,
      JSON.stringify({ pull_request: { number: 12 } }),
    );
    await writeFile(
      configPath,
      [
        "provider: github",
        "github:",
        "  tokenEnv: REVIEW_TOKEN",
        "  publish: summary",
        "",
      ].join("\n"),
    );

    await main(["node", "codereviewer", "review", "--dry-run"], {
      cwd,
      env: createGitHubEnv(eventPath),
      reviewModel: createGitHubReviewModel(),
      stdout: (text) => stdout.push(text),
    });

    const output = JSON.parse(stdout.join("\n")) as {
      command: string;
      dryRun: boolean;
      overview: {
        provider: string;
        changedFiles: number;
        commit: string;
        publishMode: string;
      };
      report: {
        summary: string;
        findings: Array<{
          path: string;
          side: string;
          startLine: number;
          endLine: number;
        }>;
      };
    };

    expect(output).toMatchObject({
      command: "review",
      dryRun: true,
      overview: {
        provider: "github",
        changedFiles: 1,
        commit: "head-sha",
        publishMode: "dry-run",
      },
      report: {
        summary: "One GitHub finding.",
        findings: [
          {
            path: "src/new.ts",
            side: "new",
            startLine: 1,
            endLine: 1,
          },
        ],
      },
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      url: "https://api.github.com/repos/acme/repo/pulls/12",
      authorization: "token secret-token",
    });
    expect(requests[1]?.url).toBe(
      "https://api.github.com/repos/acme/repo/pulls/12/files?per_page=100",
    );
  });

  it("publishes a GitHub PR summary comment when configured", async () => {
    const requests: RecordedRequest[] = [];
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-integration-"));
    const configPath = join(cwd, ".codereviewer.yml");
    const eventPath = join(cwd, "github-event.json");
    const stdout: string[] = [];

    globalThis.fetch = vi.fn(createGitHubReviewFetch({ requests }));

    await mkdir(join(cwd, ".github", "REVIEW_TEMPLATES"), {
      recursive: true,
    });
    await writeFile(
      join(cwd, ".github", "REVIEW_TEMPLATES", "summary.md"),
      [
        "GitHub summary template: {{review.summary}}",
        "{{comment.fingerprint}}",
        "",
      ].join("\n"),
    );
    await writeFile(
      eventPath,
      JSON.stringify({ pull_request: { number: 12 } }),
    );
    await writeFile(
      configPath,
      [
        "provider: github",
        "github:",
        "  tokenEnv: REVIEW_TOKEN",
        "  publish: summary",
        "",
      ].join("\n"),
    );

    await main(["node", "codereviewer", "review"], {
      cwd,
      env: createGitHubEnv(eventPath),
      reviewModel: createGitHubReviewModel(),
      stdout: (text) => stdout.push(text),
    });

    const output = JSON.parse(stdout.join("\n")) as {
      dryRun: boolean;
      publish: {
        status: string;
        commentId: number;
        commentUrl: string;
        fingerprint: string;
      };
    };
    const postRequest = requests.find((request) => request.method === "POST");
    const commentBody = readStringRecordValue(
      readPostedRequestBody(postRequest),
      "body",
    );

    expect(output.dryRun).toBe(false);
    expect(output.publish).toMatchObject({
      status: "created",
      commentId: 501,
      commentUrl: "https://github.test/comment/501",
    });
    expect(output.publish.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(postRequest).toMatchObject({
      url: "https://api.github.com/repos/acme/repo/issues/12/comments",
      authorization: "token secret-token",
      method: "POST",
    });
    expect(commentBody).not.toContain("## Code Reviewer");
    expect(commentBody).toContain(
      "GitHub summary template: One GitHub finding.",
    );
    expect(commentBody).toContain("<!-- codereviewer:summary:");
  });

  it("publishes GitHub PR inline review comments when configured", async () => {
    const requests: RecordedRequest[] = [];
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-integration-"));
    const configPath = join(cwd, ".codereviewer.yml");
    const eventPath = join(cwd, "github-event.json");
    const stdout: string[] = [];

    globalThis.fetch = vi.fn(createGitHubReviewFetch({ requests }));

    await mkdir(join(cwd, ".github", "review_templates"), {
      recursive: true,
    });
    await mkdir(join(cwd, ".github", "REVIEW_TEMPLATE"), {
      recursive: true,
    });
    await writeFile(
      join(cwd, ".github", "review_templates", "summary.md"),
      [
        "GitHub inline summary: {{review.summary}}",
        "{{comment.fingerprint}}",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(cwd, ".github", "REVIEW_TEMPLATE", "inline.md"),
      [
        "GitHub inline template: {{finding.title}}",
        "Impact: {{comment.severityLabel}}",
        "{{comment.fingerprint}}",
        "",
      ].join("\n"),
    );
    await writeFile(
      eventPath,
      JSON.stringify({ pull_request: { number: 12 } }),
    );
    await writeFile(
      configPath,
      [
        "provider: github",
        "github:",
        "  tokenEnv: REVIEW_TOKEN",
        "  publish: inline",
        "",
      ].join("\n"),
    );

    await main(["node", "codereviewer", "review"], {
      cwd,
      env: createGitHubEnv(eventPath),
      reviewModel: createGitHubReviewModel(),
      stdout: (text) => stdout.push(text),
    });

    const output = JSON.parse(stdout.join("\n")) as {
      dryRun: boolean;
      publish: {
        mode: string;
        created: number;
        skipped: number;
        unpublished: number;
      };
    };
    const postRequests = requests.filter(
      (request) => request.method === "POST",
    );
    const summaryBody = readStringRecordValue(
      readPostedRequestBody(postRequests[0]),
      "body",
    );
    const reviewCommentBody = readPostedRequestBody(postRequests[1]);
    const inlineBody = readStringRecordValue(reviewCommentBody, "body");

    expect(output.dryRun).toBe(false);
    expect(output.publish).toMatchObject({
      mode: "inline",
      created: 1,
      skipped: 0,
      unpublished: 0,
    });
    expect(
      postRequests.map((request) => new URL(request.url).pathname),
    ).toEqual([
      "/repos/acme/repo/issues/12/comments",
      "/repos/acme/repo/pulls/12/comments",
    ]);
    expect(summaryBody).toContain("GitHub inline summary: One GitHub finding.");
    expect(summaryBody).not.toContain("## Code Reviewer");
    expect(inlineBody).toContain(
      "GitHub inline template: GitHub inline finding",
    );
    expect(inlineBody).toContain("Impact: Medium");
    expect(inlineBody).not.toContain("**Issue:**");
    expect(inlineBody).toContain("<!-- codereviewer:inline:");
    expect(reviewCommentBody).toMatchObject({
      commit_id: "head-sha",
      path: "src/new.ts",
      side: "RIGHT",
      line: 1,
    });
  });

  it("fails clearly without printing dry-run JSON when GitLab diff collection fails", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-integration-"));
    const configPath = join(cwd, ".codereviewer.yml");
    const stdout: string[] = [];

    const fetchMock: typeof fetch = (input) => {
      const url = fetchInputUrl(input);

      if (isGitLabApiPath(url, "/projects/123/merge_requests/9")) {
        return Promise.resolve(
          jsonResponse({
            title: "Add integration test",
            description: "Verify dry-run review context collection.",
            diff_refs: {
              base_sha: "base-sha",
              start_sha: "start-sha",
              head_sha: "head-sha",
            },
          }),
        );
      }

      if (isGitLabApiPath(url, "/projects/123/merge_requests/9/diffs")) {
        return Promise.resolve(
          new Response("server error", {
            status: 500,
            statusText: "Internal Server Error",
          }),
        );
      }

      return Promise.resolve(
        new Response("not found", {
          status: 404,
          statusText: "Not Found",
        }),
      );
    };

    globalThis.fetch = vi.fn(fetchMock);

    await writeFile(
      configPath,
      ["gitlab:", "  tokenEnv: REVIEW_TOKEN", ""].join("\n"),
    );

    await expect(
      main(["node", "codereviewer", "review", "--dry-run"], {
        cwd,
        env: {
          CI_API_V4_URL: "https://gitlab.example.test/api/v4",
          CI_PROJECT_ID: "123",
          CI_MERGE_REQUEST_IID: "9",
          REVIEW_TOKEN: "secret-token",
        },
        stdout: (text) => stdout.push(text),
      }),
    ).rejects.toThrow(
      /GitLab API request failed: 500 Internal Server Error .*merge_requests\/9\/diffs/,
    );
    expect(stdout).toEqual([]);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}

async function recordRequest(
  requests: RecordedRequest[],
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): Promise<RecordedRequest> {
  const headers = fetchInputHeaders(input, init);
  const method = fetchInputMethod(input, init);
  const body = await fetchInputJsonBody(input, init);
  const request: RecordedRequest = {
    url: fetchInputUrl(input),
    privateToken: headers.get("PRIVATE-TOKEN"),
    authorization: headers.get("authorization"),
    ...(method === undefined || method === "GET" ? {} : { method }),
    ...(body === undefined ? {} : { body }),
  };

  requests.push(request);

  return request;
}

function isGitLabApiPath(url: string, path: string): boolean {
  const parsed = new URL(url);

  return (
    parsed.origin === "https://gitlab.example.test" &&
    parsed.pathname === `/api/v4${path}`
  );
}

function isOpenAIChatCompletionRequest(request: RecordedRequest): boolean {
  return request.url === "https://model.example.test/v1/chat/completions";
}

function createOpenAICompatibleReviewHarnessFetch({
  modelContents,
  requests,
}: {
  modelContents: string[];
  requests: RecordedRequest[];
}): typeof fetch {
  const queuedModelContents = [...modelContents];

  return async (input, init) => {
    const request = await recordRequest(requests, input, init);
    const url = request.url;

    if (isGitLabApiPath(url, "/projects/123/merge_requests/9")) {
      return Promise.resolve(
        jsonResponse({
          title: "Add OpenAI-compatible harness coverage",
          description: "Verify CLI behavior with model server responses.",
          diff_refs: {
            base_sha: "base-sha",
            start_sha: "start-sha",
            head_sha: "head-sha",
          },
        }),
      );
    }

    if (isGitLabApiPath(url, "/projects/123/merge_requests/9/diffs")) {
      return Promise.resolve(
        jsonResponse([
          {
            old_path: "src/new.ts",
            new_path: "src/new.ts",
            diff: "@@ -1,1 +1,1 @@\n-export const value = false;\n+export const value = true;",
            new_file: false,
            renamed_file: false,
            deleted_file: false,
          },
        ]),
      );
    }

    if (isOpenAIChatCompletionRequest(request)) {
      const content = queuedModelContents.shift();

      if (content === undefined) {
        throw new Error("Unexpected OpenAI-compatible chat completion request");
      }

      return Promise.resolve(openAIChatCompletionResponse(content));
    }

    return Promise.resolve(
      new Response("not found", {
        status: 404,
        statusText: "Not Found",
      }),
    );
  };
}

function openAIChatCompletionResponse(content: string): Response {
  return jsonResponse({
    choices: [
      {
        message: {
          content,
        },
      },
    ],
  });
}

function createGitHubReviewModel(): ReviewModel {
  return {
    complete() {
      return Promise.resolve({
        content: JSON.stringify({
          summary: "One GitHub finding.",
          findings: [
            {
              path: "src/new.ts",
              side: "new",
              startLine: 1,
              endLine: 1,
              code: "export const reviewed = true;",
              severity: "medium",
              title: "GitHub inline finding",
              body: "The GitHub path should publish anchored review output.",
              suggestion: "Add a focused regression test for this export.",
              replacementCode: "",
            },
          ],
        }),
      });
    },
  };
}

function createGitHubEnv(eventPath: string): Record<string, string> {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "acme/repo",
    GITHUB_EVENT_PATH: eventPath,
    REVIEW_TOKEN: "secret-token",
  };
}

function createGitHubReviewFetch({
  modelContent,
  requests,
}: {
  modelContent?: string;
  requests: RecordedRequest[];
}): typeof fetch {
  return async (input, init) => {
    const request = await recordRequest(requests, input, init);
    const url = request.url;

    if (isGitHubApiPath(url, "/repos/acme/repo/pulls/12")) {
      return Promise.resolve(
        jsonResponse({
          title: "Add GitHub integration test",
          body: "Verify GitHub review context collection.",
          head: {
            sha: "head-sha",
          },
        }),
      );
    }

    if (isGitHubApiPath(url, "/repos/acme/repo/pulls/12/files")) {
      return Promise.resolve(
        jsonResponse([
          {
            filename: "src/new.ts",
            status: "added",
            patch: "@@ -0,0 +1,1 @@\n+export const reviewed = true;",
          },
        ]),
      );
    }

    if (
      isGitHubApiPath(url, "/repos/acme/repo/issues/12/comments") &&
      request.method === undefined
    ) {
      return Promise.resolve(jsonResponse([]));
    }

    if (
      isGitHubApiPath(url, "/repos/acme/repo/issues/12/comments") &&
      request.method === "POST"
    ) {
      const body = readStringRecordValue(
        readPostedRequestBody(request),
        "body",
      );

      return Promise.resolve(
        jsonResponse({
          id: 501,
          body,
          html_url: "https://github.test/comment/501",
        }),
      );
    }

    if (
      isGitHubApiPath(url, "/repos/acme/repo/pulls/12/comments") &&
      request.method === undefined
    ) {
      return Promise.resolve(jsonResponse([]));
    }

    if (
      isGitHubApiPath(url, "/repos/acme/repo/pulls/12/comments") &&
      request.method === "POST"
    ) {
      const body = readStringRecordValue(
        readPostedRequestBody(request),
        "body",
      );

      return Promise.resolve(
        jsonResponse({
          id: 601,
          body,
          html_url: "https://github.test/comment/601",
          path: "src/new.ts",
          side: "RIGHT",
          line: 1,
        }),
      );
    }

    if (modelContent !== undefined && isOpenAIChatCompletionRequest(request)) {
      return Promise.resolve(openAIChatCompletionResponse(modelContent));
    }

    return Promise.resolve(
      new Response("not found", {
        status: 404,
        statusText: "Not Found",
      }),
    );
  };
}

function isGitHubApiPath(url: string, path: string): boolean {
  const parsed = new URL(url);

  return parsed.origin === "https://api.github.com" && parsed.pathname === path;
}

function fetchInputUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.href;
  }

  return input.url;
}

function fetchInputHeaders(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): Headers {
  if (input instanceof Request) {
    return input.headers;
  }

  return new Headers(init?.headers);
}

function fetchInputMethod(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): string | undefined {
  if (input instanceof Request) {
    return input.method;
  }

  return init?.method;
}

async function fetchInputJsonBody(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): Promise<unknown> {
  const rawBody =
    input instanceof Request
      ? await input.clone().text()
      : typeof init?.body === "string"
        ? init.body
        : undefined;

  if (rawBody === undefined || rawBody.length === 0) {
    return undefined;
  }

  const contentType =
    input instanceof Request ? (input.headers.get("content-type") ?? "") : "";

  if (isFormContentType(contentType)) {
    return formBodyToRecord(rawBody, contentType);
  }

  return JSON.parse(rawBody) as unknown;
}

function isFormContentType(contentType: string): boolean {
  return (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  );
}

function formBodyToRecord(
  rawBody: string,
  contentType: string,
): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  const fields = contentType.includes("application/x-www-form-urlencoded")
    ? new URLSearchParams(rawBody).entries()
    : multipartFields(rawBody, contentType);

  for (const [key, value] of fields) {
    const nestedMatch = /^([^[]+)\[([^\]]+)\]$/u.exec(key);

    if (nestedMatch === null) {
      record[key] = coerceFormValue(value);
      continue;
    }

    const parent = nestedMatch[1];
    const child = nestedMatch[2];

    if (parent === undefined || child === undefined) {
      record[key] = coerceFormValue(value);
      continue;
    }

    const nested =
      typeof record[parent] === "object" &&
      record[parent] !== null &&
      !Array.isArray(record[parent])
        ? (record[parent] as Record<string, unknown>)
        : {};
    nested[child] = coerceFormValue(value);
    record[parent] = nested;
  }

  return record;
}

function* multipartFields(
  rawBody: string,
  contentType: string,
): IterableIterator<[string, string]> {
  const boundary = readMultipartBoundary(contentType);

  if (boundary === undefined) {
    return;
  }

  for (const part of rawBody.split(`--${boundary}`)) {
    const [rawHeaders, ...bodyParts] = part.split(/\r?\n\r?\n/u);

    if (rawHeaders === undefined || bodyParts.length === 0) {
      continue;
    }

    const name = /name="([^"]+)"/u.exec(rawHeaders)?.[1];

    if (name === undefined) {
      continue;
    }

    const value = bodyParts
      .join("\n\n")
      .replace(/\r?\n--$/u, "")
      .replace(/\r?\n$/u, "");

    yield [name, value];
  }
}

function readMultipartBoundary(contentType: string): string | undefined {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/u.exec(contentType);

  if (match === null) {
    return undefined;
  }

  return match[1] || match[2];
}

function coerceFormValue(value: string): string | number {
  return /^\d+$/u.test(value) ? Number(value) : value;
}

function readPostedNoteBody(request: RecordedRequest | undefined): string {
  if (typeof request?.body === "object" && request.body !== null) {
    const body = request.body as Record<string, unknown>;
    const noteBody = body.body;

    if (!Array.isArray(request.body) && typeof noteBody === "string") {
      return noteBody;
    }
  }

  throw new Error("Expected recorded POST request body to contain a note body");
}

function readPostedRequestBody(
  request: RecordedRequest | undefined,
): Record<string, unknown> {
  if (
    typeof request?.body === "object" &&
    request.body !== null &&
    !Array.isArray(request.body)
  ) {
    return request.body as Record<string, unknown>;
  }

  throw new Error("Expected recorded POST request body");
}

function readToolParameter(
  body: Record<string, unknown>,
  toolName: string,
  parameterName: string,
): Record<string, unknown> {
  const tool = readToolDefinition(body, toolName);
  const toolFunction = readRecordValue(tool, "function");
  const parameters = readRecordValue(toolFunction, "parameters");
  const properties = readRecordValue(parameters, "properties");

  return readRecordValue(properties, parameterName);
}

function readToolNames(body: Record<string, unknown>): string[] {
  return readRecordArrayValue(body, "tools").map((tool) =>
    readStringRecordValue(readRecordValue(tool, "function"), "name"),
  );
}

function readToolDefinition(
  body: Record<string, unknown>,
  toolName: string,
): Record<string, unknown> {
  const tool = readRecordArrayValue(body, "tools").find((item) => {
    const toolFunction = readOptionalRecordValue(item, "function");

    return toolFunction?.name === toolName;
  });

  if (tool === undefined) {
    throw new Error(`Expected request to include tool ${toolName}`);
  }

  return tool;
}

function readRecordArrayValue(
  record: Record<string, unknown>,
  key: string,
): Array<Record<string, unknown>> {
  const value = record[key];

  if (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    )
  ) {
    return value as Array<Record<string, unknown>>;
  }

  throw new Error(`Expected record field ${key} to be an object array`);
}

function readRecordValue(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = record[key];

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error(`Expected record field ${key} to be an object`);
}

function readOptionalRecordValue(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error(`Expected record field ${key} to be an object`);
}

function readStringRecordValue(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];

  if (typeof value === "string") {
    return value;
  }

  throw new Error(`Expected record field ${key} to be a string`);
}
