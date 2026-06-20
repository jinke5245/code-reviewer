import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { createCli, isCliEntrypoint, main } from "../../src/cli.js";
import type { GitHubPullRequestClient } from "../../src/github/client.js";
import type { GitLabMergeRequestClient } from "../../src/gitlab/mr-context.js";
import type { ReviewModel } from "../../src/review/loop.js";

describe("createCli", () => {
  it("uses the package metadata for the executable identity", () => {
    const cli = createCli();

    expect(cli.name()).toBe("codereviewer");
    expect(cli.version()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("recognizes the CLI entrypoint when invoked through a symlinked bin path", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-cli-entry-"));
    const targetPath = join(cwd, "cli.js");
    const binPath = join(cwd, "codereviewer");

    await writeFile(targetPath, "#!/usr/bin/env node\n");
    await symlink(targetPath, binPath);

    expect(isCliEntrypoint(binPath, pathToFileURL(targetPath).href)).toBe(true);
  });

  it("runs review in dry-run mode with an explicit config file", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-cli-"));
    const configPath = await writeReviewConfig(cwd);
    const stderr: string[] = [];
    const stdout: string[] = [];
    const modelRequests: Array<{
      responseFormat?: string;
      roles: string;
    }> = [];
    const client: GitLabMergeRequestClient = {
      getMergeRequest() {
        return Promise.resolve({
          title: "Review me",
          description: "A merge request ready for review.",
          diffRefs: {
            baseSha: "base-sha",
            startSha: "start-sha",
            headSha: "head-sha",
          },
        });
      },
      listMergeRequestDiffs() {
        return Promise.resolve([
          {
            oldPath: "src/index.ts",
            newPath: "src/index.ts",
            diff: "@@ -0,0 +1,1 @@\n+export const value = 1;",
            newFile: false,
            renamedFile: false,
            deletedFile: false,
          },
        ]);
      },
    };
    const reviewModel: ReviewModel = {
      complete(request) {
        modelRequests.push({
          roles: request.messages.map((message) => message.role).join(","),
          ...(request.responseFormat === undefined
            ? {}
            : { responseFormat: request.responseFormat }),
        });
        return Promise.resolve({
          content: JSON.stringify({
            summary: "One finding.",
            findings: [
              {
                path: "src/index.ts",
                side: "new",
                startLine: 1,
                endLine: 1,
                code: "export const value = 1;",
                severity: "medium",
                title: "Check value",
                body: "The exported value needs review.",
                suggestion: "Explain why this value is safe.",
                replacementCode: "",
              },
            ],
          }),
        });
      },
    };

    await main(
      ["node", "codereviewer", "review", "--config", configPath, "--dry-run"],
      {
        cwd,
        env: {
          CI_API_V4_URL: "https://gitlab.example.test/api/v4",
          CI_PROJECT_ID: "123",
          CI_MERGE_REQUEST_IID: "7",
          GL_TOKEN: "secret-token",
        },
        gitlabClient: client,
        reviewModel,
        stderr: (text) => stderr.push(text),
        stdout: (text) => stdout.push(text),
      },
    );

    const output = JSON.parse(stdout.join("\n")) as {
      command: string;
      dryRun: boolean;
      overview: {
        changedFiles: number;
        commit: string;
        findings: number;
        highestSeverity: string;
        inlineFindings: number;
        provider: string;
        publishMode: string;
        unmappedFindings: number;
      };
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
        }>;
        promptSummary: {
          totalBytes: number;
        };
      };
    };

    expect(output.command).toBe("review");
    expect(output.dryRun).toBe(true);
    expect(output.overview).toEqual({
      commit: "head-sha",
      changedFiles: 1,
      findings: 1,
      highestSeverity: "medium",
      inlineFindings: 1,
      provider: "gitlab",
      unmappedFindings: 0,
      publishMode: "dry-run",
    });
    expect(output.report.summary).toBe("One finding.");
    expect(output.report.findings).toMatchObject([
      {
        path: "src/index.ts",
        startLine: 1,
        endLine: 1,
        severity: "medium",
        title: "Check value",
      },
    ]);
    expect(output.report.promptSummary.totalBytes).toBeGreaterThan(0);
    expect(modelRequests).toEqual([
      {
        roles: "system,user",
      },
      {
        roles: "system,user,assistant,user",
        responseFormat: "review_report",
      },
    ]);
    expect(stderr).toEqual([
      "[codereviewer] review phase round 1/12: requesting model remainingToolCalls=120",
      "[codereviewer] review phase round 2/12: finalizing report",
      "[codereviewer] review phase round 2/12: requesting model remainingToolCalls=0, responseFormat=review_report",
    ]);
  });

  it("runs review in dry-run mode for a GitHub pull request", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-cli-"));
    const eventPath = join(cwd, "event.json");
    const configPath = join(cwd, "review.yml");
    const stdout: string[] = [];
    await writeFile(eventPath, JSON.stringify({ pull_request: { number: 12 } }));
    await writeFile(
      configPath,
      [
        "provider: github",
        "model:",
        "  provider: openai-compatible",
        "  model: qwen-coder",
        "github:",
        "  publish: dry-run",
        "tools:",
        "  enabled:",
        "    - read_diff",
        "    - read_github_pr",
        "",
      ].join("\n"),
    );
    const githubClient: GitHubPullRequestClient = {
      getPullRequest() {
        return Promise.resolve({
          title: "Review me on GitHub",
          description: "A pull request ready for review.",
          headSha: "head-sha",
        });
      },
      listPullRequestDiffs() {
        return Promise.resolve([
          {
            oldPath: "src/index.ts",
            newPath: "src/index.ts",
            diff: "@@ -0,0 +1,1 @@\n+export const value = 1;",
            newFile: false,
            renamedFile: false,
            deletedFile: false,
          },
        ]);
      },
    };
    const reviewModel: ReviewModel = {
      complete() {
        return Promise.resolve({
          content: JSON.stringify({
            summary: "One GitHub finding.",
            findings: [
              {
                path: "src/index.ts",
                side: "new",
                startLine: 1,
                endLine: 1,
                code: "export const value = 1;",
                severity: "medium",
                title: "Check value",
                body: "The exported value needs review.",
                suggestion: "Explain why this value is safe.",
                replacementCode: "",
              },
            ],
          }),
        });
      },
    };

    await main(
      ["node", "codereviewer", "review", "--config", configPath, "--dry-run"],
      {
        cwd,
        env: {
          GITHUB_ACTIONS: "true",
          GITHUB_REPOSITORY: "acme/repo",
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_TOKEN: "secret-token",
        },
        githubClient,
        reviewModel,
        stdout: (text) => stdout.push(text),
      },
    );

    const output = JSON.parse(stdout.join("\n")) as {
      command: string;
      dryRun: boolean;
      overview: {
        provider: string;
        commit: string;
        changedFiles: number;
        inlineFindings: number;
      };
      publish?: unknown;
    };

    expect(output.command).toBe("review");
    expect(output.dryRun).toBe(true);
    expect(output.overview).toMatchObject({
      provider: "github",
      commit: "head-sha",
      changedFiles: 1,
      inlineFindings: 1,
    });
    expect(output.publish).toBeUndefined();
  });

  it("repairs invalid finding evidence before printing the review report", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-cli-"));
    const configPath = await writeReviewConfig(cwd);
    const stderr: string[] = [];
    const stdout: string[] = [];
    const finalRequests: string[] = [];
    const requests: Array<{
      maxRounds: number;
      remainingToolCalls: number;
      responseFormat?: "review_report";
      round: number;
    }> = [];
    const reviewModel: ReviewModel = {
      complete(request) {
        requests.push({
          maxRounds: request.maxRounds,
          remainingToolCalls: request.remainingToolCalls,
          ...(request.responseFormat === undefined
            ? {}
            : { responseFormat: request.responseFormat }),
          round: request.round,
        });

        if (request.responseFormat !== "review_report") {
          return Promise.resolve({
            content: "I have enough context to produce JSON.",
          });
        }

        finalRequests.push(request.messages.at(-1)?.content ?? "");

        if (finalRequests.length === 1) {
          return Promise.resolve({
            content: JSON.stringify({
              summary: "One finding with wrong evidence.",
              findings: [
                {
                  path: "src/index.ts",
                  side: "new",
                  startLine: 2,
                  endLine: 2,
                  code: "export const value = 1;",
                  severity: "medium",
                  title: "Check value",
                  body: "The exported value needs review.",
                  suggestion: "Explain why this value is safe.",
                  replacementCode: "",
                },
              ],
            }),
          });
        }

        return Promise.resolve({
          content: JSON.stringify({
            summary: "One repaired finding.",
            findings: [
              {
                path: "src/index.ts",
                side: "new",
                startLine: 1,
                endLine: 1,
                code: "export const value = 1;",
                severity: "medium",
                title: "Check value",
                body: "The exported value needs review.",
                suggestion: "Explain why this value is safe.",
                replacementCode: "",
              },
            ],
          }),
        });
      },
    };

    await main(
      ["node", "codereviewer", "review", "--config", configPath, "--dry-run"],
      {
        cwd,
        env: {
          CI_API_V4_URL: "https://gitlab.example.test/api/v4",
          CI_PROJECT_ID: "123",
          CI_MERGE_REQUEST_IID: "7",
          GL_TOKEN: "secret-token",
        },
        gitlabClient: createMergeRequestClient(),
        reviewModel,
        stderr: (text) => stderr.push(text),
        stdout: (text) => stdout.push(text),
      },
    );

    const output = JSON.parse(stdout.join("\n")) as {
      report: {
        summary: string;
        findings: Array<{
          code: string;
          endLine: number;
          side: string;
          startLine: number;
        }>;
      };
    };

    expect(finalRequests).toHaveLength(2);
    expect(requests).toEqual([
      {
        maxRounds: 12,
        remainingToolCalls: 120,
        round: 1,
      },
      {
        maxRounds: 12,
        remainingToolCalls: 0,
        responseFormat: "review_report",
        round: 2,
      },
      {
        maxRounds: 1,
        remainingToolCalls: 1,
        responseFormat: "review_report",
        round: 1,
      },
    ]);
    expect(finalRequests[1]).toContain(
      "Repair invalid Code Reviewer review report",
    );
    expect(finalRequests[1]).toContain("findings.0 code range");
    expect(finalRequests[1]).toContain(
      'side "new" means the new-file side of the diff',
    );
    expect(finalRequests[1]).toContain("startLine and endLine are inclusive");
    expect(finalRequests[1]).toContain(
      'code must equal the selected read_diff.lines text values joined with "\\n"',
    );
    expect(finalRequests[1]).toContain(
      "If the validation error says received code matches diff range, use that exact path, side, startLine, and endLine unless the finding should be removed.",
    );
    expect(finalRequests[1]).toContain("For multi-line findings");
    expect(stderr).toEqual([
      "[codereviewer] review phase round 1/12: requesting model remainingToolCalls=120",
      "[codereviewer] review phase round 2/12: finalizing report",
      "[codereviewer] review phase round 2/12: requesting model remainingToolCalls=0, responseFormat=review_report",
      "[codereviewer] repair phase attempt 1/3 round 1/1: requesting model remainingToolCalls=1, responseFormat=review_report",
    ]);
    expect(output.report.summary).toBe("One repaired finding.");
    expect(output.report.findings).toMatchObject([
      {
        side: "new",
        startLine: 1,
        endLine: 1,
        code: "export const value = 1;",
      },
    ]);
  });

  it("allows repair to verify invalid anchors with one read_diff call", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-cli-"));
    const configPath = await writeReviewConfig(cwd);
    const stderr: string[] = [];
    const stdout: string[] = [];
    const repairRequests: Array<{
      hasReadDiffResult: boolean;
      remainingToolCalls: number;
      responseFormat?: "review_report";
      toolCallNames: string[];
    }> = [];
    const reviewModel: ReviewModel = {
      complete(request) {
        const isRepairRequest = request.messages.some((message) =>
          message.content.includes("Repair invalid Code Reviewer review report"),
        );

        if (isRepairRequest) {
          const hasReadDiffResult = request.messages.some(
            (message) =>
              message.role === "tool" && message.name === "read_diff",
          );
          repairRequests.push({
            hasReadDiffResult,
            remainingToolCalls: request.remainingToolCalls,
            ...(request.responseFormat === undefined
              ? {}
              : { responseFormat: request.responseFormat }),
            toolCallNames: request.messages
              .filter((message) => message.role === "tool")
              .map((message) => message.name ?? ""),
          });

          if (!hasReadDiffResult) {
            return Promise.resolve({
              content: "I need the diff to repair the anchor.",
              toolCalls: [
                {
                  id: "repair-read-diff",
                  name: "read_diff",
                  arguments: {
                    path: "src/index.ts",
                  },
                },
              ],
            });
          }

          return Promise.resolve({
            content: JSON.stringify({
              summary: "One repaired finding.",
              findings: [
                {
                  path: "src/index.ts",
                  side: "new",
                  startLine: 1,
                  endLine: 1,
                  code: "export const value = 1;",
                  severity: "medium",
                  title: "Check value",
                  body: "The exported value needs review.",
                  suggestion: "Explain why this value is safe.",
                  replacementCode: "",
                },
              ],
            }),
          });
        }

        if (request.responseFormat !== "review_report") {
          return Promise.resolve({
            content: "I have enough context to produce JSON.",
          });
        }

        return Promise.resolve({
          content: JSON.stringify({
            summary: "One finding with wrong evidence.",
            findings: [
              {
                path: "src/index.ts",
                side: "new",
                startLine: 2,
                endLine: 2,
                code: "export const value = 1;",
                severity: "medium",
                title: "Check value",
                body: "The exported value needs review.",
                suggestion: "Explain why this value is safe.",
                replacementCode: "",
              },
            ],
          }),
        });
      },
    };

    await main(
      ["node", "codereviewer", "review", "--config", configPath, "--dry-run"],
      {
        cwd,
        env: {
          CI_API_V4_URL: "https://gitlab.example.test/api/v4",
          CI_PROJECT_ID: "123",
          CI_MERGE_REQUEST_IID: "7",
          GL_TOKEN: "secret-token",
        },
        gitlabClient: createMergeRequestClient(),
        reviewModel,
        stderr: (text) => stderr.push(text),
        stdout: (text) => stdout.push(text),
      },
    );

    const output = JSON.parse(stdout.join("\n")) as {
      report: {
        findings: Array<{
          code: string;
          endLine: number;
          startLine: number;
        }>;
      };
    };

    expect(repairRequests).toEqual([
      {
        hasReadDiffResult: false,
        remainingToolCalls: 1,
        responseFormat: "review_report",
        toolCallNames: [],
      },
      {
        hasReadDiffResult: true,
        remainingToolCalls: 0,
        responseFormat: "review_report",
        toolCallNames: ["read_diff"],
      },
    ]);
    expect(stderr).toEqual([
      "[codereviewer] review phase round 1/12: requesting model remainingToolCalls=120",
      "[codereviewer] review phase round 2/12: finalizing report",
      "[codereviewer] review phase round 2/12: requesting model remainingToolCalls=0, responseFormat=review_report",
      "[codereviewer] repair phase attempt 1/3 round 1/1: requesting model remainingToolCalls=1, responseFormat=review_report",
      "[codereviewer] repair phase attempt 1/3 round 1: running tool read_diff",
      "[codereviewer] repair phase attempt 1/3 round 1/1: finalizing report",
      "[codereviewer] repair phase attempt 1/3 round 1/1: requesting model remainingToolCalls=0, responseFormat=review_report",
    ]);
    expect(output.report.findings).toMatchObject([
      {
        startLine: 1,
        endLine: 1,
        code: "export const value = 1;",
      },
    ]);
  });

  it("retries repair when the repaired review report is still invalid", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-cli-"));
    const configPath = await writeReviewConfig(cwd);
    const stdout: string[] = [];
    const finalRequests: string[] = [];
    const reviewModel: ReviewModel = {
      complete(request) {
        if (request.responseFormat !== "review_report") {
          return Promise.resolve({
            content: "I have enough context to produce JSON.",
          });
        }

        finalRequests.push(request.messages.at(-1)?.content ?? "");

        if (finalRequests.length === 1) {
          return Promise.resolve({
            content: JSON.stringify({
              summary: "One finding with the wrong range.",
              findings: [
                {
                  path: "src/index.ts",
                  side: "new",
                  startLine: 2,
                  endLine: 2,
                  code: "export const value = 1;",
                  severity: "medium",
                  title: "Check value",
                  body: "The exported value needs review.",
                  suggestion: "Explain why this value is safe.",
                  replacementCode: "",
                },
              ],
            }),
          });
        }

        if (finalRequests.length === 2) {
          return Promise.resolve({
            content: JSON.stringify({
              summary: "One finding with mismatched code.",
              findings: [
                {
                  path: "src/index.ts",
                  side: "new",
                  startLine: 1,
                  endLine: 1,
                  code: "export const other = 1;",
                  severity: "medium",
                  title: "Check value",
                  body: "The exported value needs review.",
                  suggestion: "Explain why this value is safe.",
                  replacementCode: "",
                },
              ],
            }),
          });
        }

        if (finalRequests.length === 3) {
          return Promise.resolve({
            content: JSON.stringify({
              summary: "One finding with another invalid range.",
              findings: [
                {
                  path: "src/index.ts",
                  side: "new",
                  startLine: 1,
                  endLine: 1,
                  code: "export const value = 1;\n}",
                  severity: "medium",
                  title: "Check value",
                  body: "The exported value needs review.",
                  suggestion: "Explain why this value is safe.",
                  replacementCode: "",
                },
              ],
            }),
          });
        }

        return Promise.resolve({
          content: JSON.stringify({
            summary: "One repaired finding.",
            findings: [
              {
                path: "src/index.ts",
                side: "new",
                startLine: 1,
                endLine: 1,
                code: "export const value = 1;",
                severity: "medium",
                title: "Check value",
                body: "The exported value needs review.",
                suggestion: "Explain why this value is safe.",
                replacementCode: "",
              },
            ],
          }),
        });
      },
    };

    await main(
      ["node", "codereviewer", "review", "--config", configPath, "--dry-run"],
      {
        cwd,
        env: {
          CI_API_V4_URL: "https://gitlab.example.test/api/v4",
          CI_PROJECT_ID: "123",
          CI_MERGE_REQUEST_IID: "7",
          GL_TOKEN: "secret-token",
        },
        gitlabClient: createMergeRequestClient(),
        reviewModel,
        stdout: (text) => stdout.push(text),
      },
    );

    const output = JSON.parse(stdout.join("\n")) as {
      report: {
        summary: string;
        findings: Array<{
          code: string;
          endLine: number;
          startLine: number;
        }>;
      };
    };

    expect(finalRequests).toHaveLength(4);
    expect(finalRequests[1]).toContain("findings.0 code range");
    expect(finalRequests[2]).toContain("findings.0 code does not match");
    expect(finalRequests[3]).toContain("findings.0 code does not match");
    expect(output.report.summary).toBe("One repaired finding.");
    expect(output.report.findings).toMatchObject([
      {
        startLine: 1,
        endLine: 1,
        code: "export const value = 1;",
      },
    ]);
  });

  it("lets dry-run override inline publishing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-cli-"));
    const configPath = await writeReviewConfig(cwd, "inline");
    const stdout: string[] = [];
    const client: GitLabMergeRequestClient = {
      getMergeRequest() {
        return Promise.resolve({
          title: "Review me",
          description: "A merge request ready for review.",
          diffRefs: {
            baseSha: "base-sha",
            startSha: "start-sha",
            headSha: "head-sha",
          },
        });
      },
      listMergeRequestDiffs() {
        return Promise.resolve([
          {
            oldPath: "src/index.ts",
            newPath: "src/index.ts",
            diff: "@@ -0,0 +1,1 @@\n+export const value = 1;",
            newFile: false,
            renamedFile: false,
            deletedFile: false,
          },
        ]);
      },
    };
    const reviewModel: ReviewModel = {
      complete() {
        return Promise.resolve({
          content: JSON.stringify({
            summary: "No findings.",
            findings: [],
          }),
        });
      },
    };

    await main(
      ["node", "codereviewer", "review", "--config", configPath, "--dry-run"],
      {
        cwd,
        env: {
          CI_API_V4_URL: "https://gitlab.example.test/api/v4",
          CI_PROJECT_ID: "123",
          CI_MERGE_REQUEST_IID: "7",
          GL_TOKEN: "secret-token",
        },
        gitlabClient: client,
        reviewModel,
        stdout: (text) => stdout.push(text),
      },
    );

    const output = JSON.parse(stdout.join("\n")) as {
      dryRun: boolean;
      publish?: unknown;
    };

    expect(output.dryRun).toBe(true);
    expect(output.publish).toBeUndefined();
  });

  it("writes readable verbose review logs to stderr without changing stdout JSON", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-cli-"));
    const configPath = await writeReviewConfig(cwd);
    const stderr: string[] = [];
    const stdout: string[] = [];
    const reviewModel: ReviewModel = {
      complete(request) {
        if (request.round === 1) {
          return Promise.resolve({
            toolCalls: [
              {
                id: "call_1",
                name: "read_diff",
                arguments: {
                  path: "src/index.ts",
                },
              },
            ],
          });
        }

        return Promise.resolve({
          content: JSON.stringify({
            summary: "No findings.",
            findings: [],
          }),
        });
      },
    };

    await main(
      [
        "node",
        "codereviewer",
        "review",
        "--config",
        configPath,
        "--dry-run",
        "--verbose",
      ],
      {
        cwd,
        env: {
          CI_API_V4_URL: "https://gitlab.example.test/api/v4",
          CI_PROJECT_ID: "123",
          CI_MERGE_REQUEST_IID: "7",
          GL_TOKEN: "secret-token",
        },
        gitlabClient: createMergeRequestClient(),
        reviewModel,
        stderr: (text) => stderr.push(text),
        stdout: (text) => stdout.push(text),
      },
    );

    const output = JSON.parse(stdout.join("\n")) as {
      command: string;
      report: {
        summary: string;
      };
    };
    const logs = stderr.join("\n");

    expect(output.command).toBe("review");
    expect(output.report.summary).toBe("No findings.");
    expect(logs).toContain("[codereviewer] info: loaded review config");
    expect(logs).toContain(
      "[codereviewer] info: loaded merge request context",
    );
    expect(logs).toContain("[codereviewer] info: prepared review prompts");
    expect(logs).toContain(
      "[codereviewer] info: review phase round 1/12 requesting model",
    );
    expect(logs).toContain(
      "[codereviewer] info: review phase round 1 running tool read_diff",
    );
    expect(logs).toContain('arguments={"path":"src/index.ts"}');
    expect(logs).toContain(
      "[codereviewer] info: review phase round 1 completed tool read_diff",
    );
    expect(logs).toContain("resultBytes=");
    expect(logs).toContain("[codereviewer] info: completed review command");
    expect(logs).not.toContain("@@ -0,0 +1,1 @@");
    expect(logs).not.toContain("export const value = 1;");
  });

  it("marks the review command as failed when findings meet the configured severity threshold", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-cli-"));
    const configPath = await writeReviewConfig(cwd, "dry-run", "medium");
    const stdout: string[] = [];
    const exitCodes: number[] = [];
    const reviewModel: ReviewModel = {
      complete() {
        return Promise.resolve({
          content: JSON.stringify({
            summary: "One finding.",
            findings: [
              {
                path: "src/index.ts",
                side: "new",
                startLine: 1,
                endLine: 1,
                code: "export const value = 1;",
                severity: "medium",
                title: "Check value",
                body: "The exported value needs review.",
                suggestion: "Explain why this value is safe.",
                replacementCode: "",
              },
            ],
          }),
        });
      },
    };

    await main(["node", "codereviewer", "review", "--config", configPath], {
      cwd,
      env: {
        CI_API_V4_URL: "https://gitlab.example.test/api/v4",
        CI_PROJECT_ID: "123",
        CI_MERGE_REQUEST_IID: "7",
        GL_TOKEN: "secret-token",
      },
      gitlabClient: createMergeRequestClient(),
      reviewModel,
      setExitCode: (code) => exitCodes.push(code),
      stdout: (text) => stdout.push(text),
    });

    const output = JSON.parse(stdout.join("\n")) as {
      report: {
        findings: Array<{
          severity: string;
        }>;
      };
    };

    expect(output.report.findings).toMatchObject([
      {
        severity: "medium",
      },
    ]);
    expect(exitCodes).toEqual([1]);
  });

  it("does not fail below the configured severity threshold", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-cli-"));
    const configPath = await writeReviewConfig(cwd, "dry-run", "high");
    const exitCodes: number[] = [];
    const reviewModel: ReviewModel = {
      complete() {
        return Promise.resolve({
          content: JSON.stringify({
            summary: "One lower-severity finding.",
            findings: [
              {
                path: "src/index.ts",
                side: "new",
                startLine: 1,
                endLine: 1,
                code: "export const value = 1;",
                severity: "medium",
                title: "Check value",
                body: "The exported value needs review.",
                suggestion: "Explain why this value is safe.",
                replacementCode: "",
              },
            ],
          }),
        });
      },
    };

    await main(["node", "codereviewer", "review", "--config", configPath], {
      cwd,
      env: {
        CI_API_V4_URL: "https://gitlab.example.test/api/v4",
        CI_PROJECT_ID: "123",
        CI_MERGE_REQUEST_IID: "7",
        GL_TOKEN: "secret-token",
      },
      gitlabClient: createMergeRequestClient(),
      reviewModel,
      setExitCode: (code) => exitCodes.push(code),
      stdout: () => {},
    });

    expect(exitCodes).toEqual([]);
  });

  it("reports missing GitLab CI environment variables in dry-run mode", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-cli-"));
    const configPath = await writeReviewConfig(cwd);

    await expect(
      main(
        [
          "node",
          "codereviewer",
          "review",
          "--config",
          configPath,
          "--dry-run",
        ],
        {
          cwd,
          env: {
            GL_TOKEN: "secret-token",
          },
          stdout: () => {
            throw new Error("stdout should not be called");
          },
        },
      ),
    ).rejects.toThrow(
      /Missing GitLab merge request environment variables: CI_API_V4_URL, CI_PROJECT_ID, CI_MERGE_REQUEST_IID/,
    );
  });

  it("passes invalid model tool-call arguments back to the model as tool errors", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-cli-"));
    const configPath = join(cwd, "review.yml");
    const stdout: string[] = [];
    const requests: Parameters<ReviewModel["complete"]>[0][] = [];
    const reviewModel: ReviewModel = {
      complete(request) {
        requests.push(request);

        if (requests.length > 1) {
          return Promise.resolve({
            content: '{"summary":"Tool error handled","findings":[]}',
          });
        }

        return Promise.resolve({
          toolCalls: [
            {
              id: "call_1",
              name: "list_gitlab_issues",
              arguments: {
                limit: 101,
              },
            },
          ],
        });
      },
    };

    await writeFile(
      configPath,
      [
        "model:",
        "  provider: openai-compatible",
        "  model: qwen-coder",
        "gitlab:",
        "  tokenEnv: GL_TOKEN",
        "  publish: dry-run",
        "tools:",
        "  enabled:",
        "    - list_gitlab_issues",
        "",
      ].join("\n"),
    );

    await main(["node", "codereviewer", "review", "--config", configPath], {
      cwd,
      env: {
        CI_API_V4_URL: "https://gitlab.example.test/api/v4",
        CI_PROJECT_ID: "123",
        CI_MERGE_REQUEST_IID: "7",
        GL_TOKEN: "secret-token",
      },
      gitlabClient: createMergeRequestClient(),
      reviewModel,
      stdout: (text) => stdout.push(text),
    });

    const output = JSON.parse(stdout.join("\n")) as {
      report: {
        summary: string;
      };
    };

    expect(requests[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      name: "list_gitlab_issues",
    });
    expect(requests[1]?.messages.at(-1)?.content).toContain(
      "Tool call failed:",
    );
    expect(requests[1]?.messages.at(-1)?.content).toContain("Too big");
    expect(output.report.summary).toBe("Tool error handled");
  });
});

async function writeReviewConfig(
  cwd: string,
  publish: "dry-run" | "summary" | "inline" = "dry-run",
  failOnSeverity = "none",
): Promise<string> {
  const configPath = join(cwd, "review.yml");

  await writeFile(
    configPath,
    [
      "model:",
      "  provider: openai-compatible",
      "  model: qwen-coder",
      "gitlab:",
      "  tokenEnv: GL_TOKEN",
      `  publish: ${publish}`,
      `  failOnSeverity: ${failOnSeverity}`,
      "tools:",
      "  enabled:",
      "    - read_diff",
      "",
    ].join("\n"),
  );

  return configPath;
}

function createMergeRequestClient(): GitLabMergeRequestClient {
  return {
    getMergeRequest() {
      return Promise.resolve({
        title: "Review me",
        description: "A merge request ready for review.",
        diffRefs: {
          baseSha: "base-sha",
          startSha: "start-sha",
          headSha: "head-sha",
        },
      });
    },
    listMergeRequestDiffs() {
      return Promise.resolve([
        {
          oldPath: "src/index.ts",
          newPath: "src/index.ts",
          diff: "@@ -0,0 +1,1 @@\n+export const value = 1;",
          newFile: false,
          renamedFile: false,
          deletedFile: false,
        },
      ]);
    },
  };
}
