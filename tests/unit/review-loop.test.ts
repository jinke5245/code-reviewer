import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";
import { z, ZodError } from "zod";

import type { GitLabMergeRequestContext } from "../../src/gitlab/mr-context.js";
import {
  runReviewLoop,
  type ReviewModel,
  type ReviewModelRequest,
} from "../../src/review/loop.js";
import { createToolRunner } from "../../src/tools/runner.js";
import type { ToolCall, ToolRunner } from "../../src/tools/types.js";

describe("runReviewLoop", () => {
  it("requests a structured final report after exploration stops without tool calls", async () => {
    const requests: ReviewModelRequest[] = [];
    const toolRunner: ToolRunner = {
      execute() {
        throw new Error("Tool runner should not be called");
      },
    };
    const model: ReviewModel = {
      complete(request) {
        requests.push(request);

        if (requests.length === 1) {
          return Promise.resolve({
            content: "I have enough context to write the final review.",
          });
        }

        return Promise.resolve({
          content: '{"summary":"Structured final report","findings":[]}',
        });
      },
    };

    await expect(
      runReviewLoop({
        maxRounds: 3,
        maxToolCalls: 5,
        messages: [
          {
            role: "user",
            content: "Review this merge request.",
          },
        ],
        model,
        toolRunner,
      }),
    ).resolves.toMatchObject({
      finalMessage: '{"summary":"Structured final report","findings":[]}',
      rounds: 2,
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]).not.toMatchObject({
      responseFormat: "review_report",
    });
    expect(requests[1]).toMatchObject({
      round: 2,
      remainingToolCalls: 0,
      responseFormat: "review_report",
    });
    expect(requests[1]?.messages.at(-2)).toEqual({
      role: "assistant",
      content: "I have enough context to write the final review.",
    });
    expect(requests[1]?.messages.at(-1)?.content).toContain(
      "Return the final review JSON",
    );
    expect(requests[1]?.messages.at(-1)?.content).toContain(
      'The first non-whitespace character must be "{"',
    );
    expect(requests[1]?.messages.at(-1)?.content).toContain(
      'the last non-whitespace character must be "}"',
    );
    expect(requests[1]?.messages.at(-1)?.content).toContain(
      "side/startLine/endLine/code must identify the smallest exact code range",
    );
    expect(requests[1]?.messages.at(-1)?.content).toContain(
      'side "new" means the new-file side of the diff',
    );
    expect(requests[1]?.messages.at(-1)?.content).toContain(
      "startLine and endLine are inclusive",
    );
    expect(requests[1]?.messages.at(-1)?.content).toContain(
      'code must equal the selected read_diff.lines text values joined with "\\n"',
    );
    expect(requests[1]?.messages.at(-1)?.content).toContain(
      "For multi-line findings",
    );
    expect(requests[1]?.messages.at(-1)?.content).toContain(
      "Do not use approximate, nearby, or repository-file line numbers",
    );
    expect(requests[1]?.messages.at(-1)?.content).toContain(
      "Every actionable issue mentioned in summary must also appear in findings.",
    );
    expect(requests[1]?.messages.at(-1)?.content).toContain(
      "Do not return duplicate findings",
    );
  });

  it("executes native model tool calls before returning the final response", async () => {
    const toolCalls: ToolCall[] = [];
    const requests: ReviewModelRequest[] = [];
    const toolRunner: ToolRunner = {
      execute(call) {
        toolCalls.push(call);
        return Promise.resolve({
          diff: "@@\n-old\n+new",
        });
      },
    };
    const model: ReviewModel = {
      complete(request) {
        requests.push(request);

        if (requests.length === 1) {
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
          content: '{"findings":[]}',
        });
      },
    };

    const result = await runReviewLoop({
      maxRounds: 3,
      maxToolCalls: 5,
      messages: [
        {
          role: "user",
          content: "Review this merge request.",
        },
      ],
      model,
      toolRunner,
    });

    expect(toolCalls).toEqual([
      {
        name: "read_diff",
        arguments: {
          path: "src/index.ts",
        },
      },
    ]);
    expect(requests).toHaveLength(3);
    expect(requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      toolCallId: "call_1",
      name: "read_diff",
      content: JSON.stringify({
        diff: "@@\n-old\n+new",
      }),
    });
    expect(requests[2]).toMatchObject({
      round: 3,
      remainingToolCalls: 0,
      responseFormat: "review_report",
    });
    expect(result).toEqual({
      finalMessage: '{"findings":[]}',
      rounds: 3,
      toolCalls: [
        {
          id: "call_1",
          name: "read_diff",
          arguments: {
            path: "src/index.ts",
          },
          result: {
            diff: "@@\n-old\n+new",
          },
        },
      ],
    });
  });

  it("records tool failures as tool results so the model can continue", async () => {
    const requests: ReviewModelRequest[] = [];
    const toolRunner: ToolRunner = {
      execute() {
        throw new Error("GitLab request timed out");
      },
    };
    const model: ReviewModel = {
      complete(request) {
        requests.push(request);

        if (requests.length === 1) {
          return Promise.resolve({
            toolCalls: [
              {
                id: "call_1",
                name: "read_gitlab_mr",
                arguments: {},
              },
            ],
          });
        }

        return Promise.resolve({
          content: '{"summary":"Recovered from tool error","findings":[]}',
        });
      },
    };

    const result = await runReviewLoop({
      maxRounds: 3,
      maxToolCalls: 5,
      messages: [
        {
          role: "user",
          content: "Review this merge request.",
        },
      ],
      model,
      toolRunner,
    });

    expect(requests).toHaveLength(3);
    expect(requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      toolCallId: "call_1",
      name: "read_gitlab_mr",
      content: JSON.stringify({
        error: "Tool call failed: GitLab request timed out",
      }),
    });
    expect(result.toolCalls).toEqual([
      {
        id: "call_1",
        name: "read_gitlab_mr",
        arguments: {},
        result: {
          error: "Tool call failed: GitLab request timed out",
        },
      },
    ]);
  });

  it("emits review progress events for model requests, tools, and finalization", async () => {
    const events: unknown[] = [];
    const toolRunner: ToolRunner = {
      execute() {
        return Promise.resolve({
          content: "file content",
        });
      },
    };
    const model: ReviewModel = {
      complete(request) {
        if (request.round === 1) {
          return Promise.resolve({
            toolCalls: [
              {
                id: "call_1",
                name: "read_file",
                arguments: {
                  path: "src/index.ts",
                },
              },
            ],
          });
        }

        return Promise.resolve({
          content: '{"summary":"Done","findings":[]}',
        });
      },
    };

    await runReviewLoop({
      maxRounds: 3,
      maxToolCalls: 5,
      messages: [
        {
          role: "user",
          content: "Review this merge request.",
        },
      ],
      model,
      onEvent(event) {
        events.push(event);
      },
      toolRunner,
    });

    expect(events).toEqual([
      {
        type: "model_request",
        round: 1,
        maxRounds: 3,
        remainingToolCalls: 5,
      },
      {
        type: "tool_call",
        arguments: '{"path":"src/index.ts"}',
        round: 1,
        name: "read_file",
      },
      {
        type: "tool_result",
        failed: false,
        name: "read_file",
        resultBytes: 26,
        round: 1,
      },
      {
        type: "model_request",
        round: 2,
        maxRounds: 3,
        remainingToolCalls: 4,
      },
      {
        type: "final_report_request",
        round: 3,
        maxRounds: 3,
      },
      {
        type: "model_request",
        round: 3,
        maxRounds: 3,
        remainingToolCalls: 0,
        responseFormat: "review_report",
      },
    ]);
  });

  it("redacts only sensitive tool argument keys in review events", async () => {
    const events: unknown[] = [];
    const toolRunner: ToolRunner = {
      execute() {
        return Promise.resolve({
          ok: true,
        });
      },
    };
    const model: ReviewModel = {
      complete(request) {
        if (request.round === 1) {
          return Promise.resolve({
            toolCalls: [
              {
                id: "call_1",
                name: "read_gitlab_mr",
                arguments: {
                  apiKey: "secret-api-key",
                  keyboard: "visible-keyboard",
                  nested: {
                    accessToken: "secret-token",
                    monkey: "visible-monkey",
                  },
                },
              },
            ],
          });
        }

        return Promise.resolve({
          content: '{"summary":"Done","findings":[]}',
        });
      },
    };

    await runReviewLoop({
      maxRounds: 3,
      maxToolCalls: 5,
      messages: [
        {
          role: "user",
          content: "Review this merge request.",
        },
      ],
      model,
      onEvent(event) {
        events.push(event);
      },
      toolRunner,
    });

    expect(events).toContainEqual({
      type: "tool_call",
      arguments:
        '{"apiKey":"[redacted]","keyboard":"visible-keyboard","nested":{"accessToken":"[redacted]","monkey":"visible-monkey"}}',
      round: 1,
      name: "read_gitlab_mr",
    });
  });

  it("does not mark ordinary tool results with error fields as failed", async () => {
    const events: unknown[] = [];
    const toolRunner: ToolRunner = {
      execute() {
        return Promise.resolve({
          error: "no matches",
          matches: [],
        });
      },
    };
    const model: ReviewModel = {
      complete(request) {
        if (request.round === 1) {
          return Promise.resolve({
            toolCalls: [
              {
                id: "call_1",
                name: "repo_search",
                arguments: {
                  query: "needle",
                },
              },
            ],
          });
        }

        return Promise.resolve({
          content: '{"summary":"Done","findings":[]}',
        });
      },
    };

    await runReviewLoop({
      maxRounds: 3,
      maxToolCalls: 5,
      messages: [
        {
          role: "user",
          content: "Review this merge request.",
        },
      ],
      model,
      onEvent(event) {
        events.push(event);
      },
      toolRunner,
    });

    expect(events).toContainEqual({
      type: "tool_result",
      failed: false,
      name: "repo_search",
      resultBytes: 35,
      round: 1,
    });
  });

  it("executes JSON fallback tool calls from model content", async () => {
    const toolCalls: ToolCall[] = [];
    const toolRunner: ToolRunner = {
      execute(call) {
        toolCalls.push(call);
        return Promise.resolve({
          matches: [
            {
              path: "src/index.ts",
              line: 1,
              text: "const needle = true;",
            },
          ],
        });
      },
    };
    let completions = 0;
    const model: ReviewModel = {
      complete() {
        completions += 1;

        if (completions === 1) {
          return Promise.resolve({
            content: JSON.stringify({
              message: "I need to inspect the repository.",
              tool_calls: [
                {
                  id: "json_call_1",
                  name: "repo_search",
                  arguments: {
                    query: "needle",
                  },
                },
              ],
            }),
          });
        }

        return Promise.resolve({
          content: "No findings.",
        });
      },
    };

    const result = await runReviewLoop({
      maxRounds: 3,
      maxToolCalls: 5,
      messages: [
        {
          role: "user",
          content: "Review this merge request.",
        },
      ],
      model,
      toolRunner,
    });

    expect(toolCalls).toEqual([
      {
        name: "repo_search",
        arguments: {
          query: "needle",
        },
      },
    ]);
    expect(result.finalMessage).toBe("No findings.");
    expect(result.toolCalls).toHaveLength(1);
  });

  it("assigns ids to JSON fallback tool calls before follow-up model requests", async () => {
    const requests: ReviewModelRequest[] = [];
    const toolRunner: ToolRunner = {
      execute() {
        return Promise.resolve({
          diff: "@@\n-old\n+new",
        });
      },
    };
    const model: ReviewModel = {
      complete(request) {
        requests.push(request);

        if (requests.length === 1) {
          return Promise.resolve({
            content: JSON.stringify({
              tool_calls: [
                {
                  name: "read_diff",
                  arguments: {
                    path: "src/index.ts",
                  },
                },
              ],
            }),
          });
        }

        return Promise.resolve({
          content: "No findings.",
        });
      },
    };

    const result = await runReviewLoop({
      maxRounds: 3,
      maxToolCalls: 5,
      messages: [
        {
          role: "user",
          content: "Review this merge request.",
        },
      ],
      model,
      toolRunner,
    });

    const assignedId = result.toolCalls[0]?.id;

    expect(assignedId).toMatch(/^json_tool_call_1$/u);
    expect(requests[1]?.messages.at(-2)).toMatchObject({
      role: "assistant",
      toolCalls: [
        {
          id: assignedId,
          name: "read_diff",
        },
      ],
    });
    expect(requests[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      toolCallId: assignedId,
    });
  });

  it("generates JSON fallback tool call ids that do not collide with existing ids", async () => {
    const requests: ReviewModelRequest[] = [];
    const toolRunner: ToolRunner = {
      execute() {
        return Promise.resolve({
          ok: true,
        });
      },
    };
    const model: ReviewModel = {
      complete(request) {
        requests.push(request);

        if (requests.length === 1) {
          return Promise.resolve({
            content: JSON.stringify({
              tool_calls: [
                {
                  id: "json_tool_call_1",
                  name: "read_gitlab_mr",
                  arguments: {},
                },
                {
                  name: "read_gitlab_mr",
                  arguments: {},
                },
              ],
            }),
          });
        }

        return Promise.resolve({
          content: "No findings.",
        });
      },
    };

    const result = await runReviewLoop({
      maxRounds: 3,
      maxToolCalls: 5,
      messages: [
        {
          role: "user",
          content: "Review this merge request.",
        },
      ],
      model,
      toolRunner,
    });

    const ids = result.toolCalls.map((toolCall) => toolCall.id);

    expect(ids).toEqual(["json_tool_call_1", "json_tool_call_2"]);
    expect(requests[1]?.messages.at(-3)).toMatchObject({
      role: "assistant",
      toolCalls: [
        {
          id: "json_tool_call_1",
        },
        {
          id: "json_tool_call_2",
        },
      ],
    });
    expect(requests[1]?.messages.at(-2)).toMatchObject({
      role: "tool",
      toolCallId: "json_tool_call_1",
    });
    expect(requests[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      toolCallId: "json_tool_call_2",
    });
  });

  it("normalizes duplicate JSON fallback tool call ids", async () => {
    const requests: ReviewModelRequest[] = [];
    const toolRunner: ToolRunner = {
      execute() {
        return Promise.resolve({
          ok: true,
        });
      },
    };
    const model: ReviewModel = {
      complete(request) {
        requests.push(request);

        if (requests.length === 1) {
          return Promise.resolve({
            content: JSON.stringify({
              tool_calls: [
                {
                  id: "json_tool_call_1",
                  name: "read_gitlab_mr",
                  arguments: {},
                },
                {
                  id: "json_tool_call_1",
                  name: "read_gitlab_mr",
                  arguments: {},
                },
              ],
            }),
          });
        }

        return Promise.resolve({
          content: "No findings.",
        });
      },
    };

    const result = await runReviewLoop({
      maxRounds: 3,
      maxToolCalls: 5,
      messages: [
        {
          role: "user",
          content: "Review this merge request.",
        },
      ],
      model,
      toolRunner,
    });

    const ids = result.toolCalls.map((toolCall) => toolCall.id);

    expect(ids).toEqual(["json_tool_call_1", "json_tool_call_2"]);
    expect(requests[1]?.messages.at(-3)).toMatchObject({
      role: "assistant",
      toolCalls: [
        {
          id: "json_tool_call_1",
        },
        {
          id: "json_tool_call_2",
        },
      ],
    });
    expect(requests[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      toolCallId: "json_tool_call_2",
    });
  });

  it("does not execute JSON fallback tool calls from ordinary JSON responses", async () => {
    const toolCalls: ToolCall[] = [];
    const toolRunner: ToolRunner = {
      execute(call) {
        toolCalls.push(call);
        return Promise.resolve({
          ok: true,
        });
      },
    };
    const model: ReviewModel = {
      complete() {
        return Promise.resolve({
          content: JSON.stringify({
            summary: "Final JSON report.",
            findings: [],
            tool_calls: [
              {
                name: "read_gitlab_mr",
                arguments: {},
              },
            ],
          }),
        });
      },
    };

    const result = await runReviewLoop({
      maxRounds: 3,
      maxToolCalls: 5,
      messages: [
        {
          role: "user",
          content: "Review this merge request.",
        },
      ],
      model,
      toolRunner,
    });

    expect(toolCalls).toEqual([]);
    expect(result.toolCalls).toEqual([]);
    expect(result.finalMessage).toContain("Final JSON report");
  });

  it("requests a final response without tools at maxRounds when maxRounds is reached", async () => {
    const requests: ReviewModelRequest[] = [];
    const toolRunner: ToolRunner = {
      execute() {
        return Promise.resolve({
          ok: true,
        });
      },
    };
    const model: ReviewModel = {
      complete(request) {
        requests.push(request);

        if (request.remainingToolCalls === 0) {
          return Promise.resolve({
            content: '{"summary":"Final from available context","findings":[]}',
          });
        }

        return Promise.resolve({
          toolCalls: [
            {
              name: "read_gitlab_mr",
              arguments: {},
            },
          ],
        });
      },
    };

    await expect(
      runReviewLoop({
        maxRounds: 2,
        maxToolCalls: 5,
        messages: [
          {
            role: "user",
            content: "Review this merge request.",
          },
        ],
        model,
        toolRunner,
      }),
    ).resolves.toMatchObject({
      finalMessage: '{"summary":"Final from available context","findings":[]}',
      rounds: 2,
    });
    expect(requests).toHaveLength(3);
    expect(requests[2]).toMatchObject({
      round: 2,
      maxRounds: 2,
      remainingToolCalls: 0,
    });
    const finalPromptMessage = requests[2]?.messages.at(-1);
    expect(finalPromptMessage?.role).toBe("user");
    expect(finalPromptMessage?.content).toContain(
      "Return the final review JSON",
    );
    expect(finalPromptMessage?.content).toContain(
      "Do not include markdown fences",
    );
    expect(finalPromptMessage?.content).toContain(
      "Do not write any prose before or after the JSON",
    );
    expect(finalPromptMessage?.content).toContain(
      'The first non-whitespace character must be "{"',
    );
  });

  it("fails when the model response has neither content nor tool calls", async () => {
    const toolRunner: ToolRunner = {
      execute() {
        throw new Error("Tool runner should not be called");
      },
    };
    const model: ReviewModel = {
      complete() {
        return Promise.resolve({});
      },
    };

    await expect(
      runReviewLoop({
        maxRounds: 1,
        maxToolCalls: 1,
        messages: [
          {
            role: "user",
            content: "Review this merge request.",
          },
        ],
        model,
        toolRunner,
      }),
    ).rejects.toThrow(
      /Model response did not include final content or tool calls/,
    );
  });

  it("rejects invalid JSON fallback tool call envelopes", async () => {
    const toolRunner: ToolRunner = {
      execute() {
        throw new Error("Tool runner should not be called");
      },
    };
    const model: ReviewModel = {
      complete() {
        return Promise.resolve({
          content: JSON.stringify({
            tool_calls: [
              {
                arguments: {},
              },
            ],
          }),
        });
      },
    };

    await expect(
      runReviewLoop({
        maxRounds: 1,
        maxToolCalls: 1,
        messages: [
          {
            role: "user",
            content: "Review this merge request.",
          },
        ],
        model,
        toolRunner,
      }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("requests a final response without tools when model requests too many tool calls", async () => {
    const requests: ReviewModelRequest[] = [];
    const toolCalls: ToolCall[] = [];
    const toolRunner: ToolRunner = {
      execute(call) {
        toolCalls.push(call);
        return Promise.resolve({
          ok: true,
        });
      },
    };
    const model: ReviewModel = {
      complete(request) {
        requests.push(request);

        if (requests.length === 2) {
          return Promise.resolve({
            content: '{"summary":"Final from available context","findings":[]}',
          });
        }

        return Promise.resolve({
          toolCalls: [
            {
              name: "read_gitlab_mr",
              arguments: {},
            },
            {
              name: "read_gitlab_mr",
              arguments: {},
            },
          ],
        });
      },
    };

    await expect(
      runReviewLoop({
        maxRounds: 2,
        maxToolCalls: 1,
        messages: [
          {
            role: "user",
            content: "Review this merge request.",
          },
        ],
        model,
        toolRunner,
      }),
    ).resolves.toMatchObject({
      finalMessage: '{"summary":"Final from available context","findings":[]}',
      rounds: 2,
      toolCalls: [],
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      round: 2,
      maxRounds: 2,
      remainingToolCalls: 0,
      responseFormat: "review_report",
    });
    expect(toolCalls).toEqual([]);
  });

  it("lets the tool runner schema-validate model tool arguments", async () => {
    const requests: ReviewModelRequest[] = [];
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-review-loop-")),
      context: createContext(),
      enabledTools: ["typed_tool"],
      tools: {
        typed_tool: {
          inputSchema: z.object({
            path: z.string(),
          }),
          execute(args) {
            return Promise.resolve(args);
          },
        },
      },
    });
    const model: ReviewModel = {
      complete(request) {
        requests.push(request);

        if (requests.length > 1) {
          return Promise.resolve({
            content: '{"summary":"Validation error recorded","findings":[]}',
          });
        }

        return Promise.resolve({
          toolCalls: [
            {
              name: "typed_tool",
              arguments: {
                path: 42,
              },
            },
          ],
        });
      },
    };

    const result = await runReviewLoop({
      maxRounds: 2,
      maxToolCalls: 1,
      messages: [
        {
          role: "user",
          content: "Review this merge request.",
        },
      ],
      model,
      toolRunner: runner,
    });

    expect(requests).toHaveLength(3);
    expect(requests[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      name: "typed_tool",
    });
    expect(requests[1]?.messages.at(-1)?.content).toContain(
      "Tool call failed:",
    );
    expect(requests[1]?.messages.at(-1)?.content).toContain("path");
    const serializedToolResult = JSON.stringify(result.toolCalls[0]?.result);

    expect(serializedToolResult).toContain("Tool call failed:");
    expect(serializedToolResult).toContain("path");
  });
});

function createContext(): GitLabMergeRequestContext {
  return {
    source: "gitlab-merge-request",
    provider: "gitlab",
    gitlab: {
      apiUrl: "https://gitlab.example.test/api/v4",
      projectId: "123",
      mergeRequestIid: "42",
    },
    mergeRequest: {
      title: "Add review loop",
      description: "Let the model request tools before final output.",
      diffRefs: {
        baseSha: "base-sha",
        startSha: "start-sha",
        headSha: "head-sha",
      },
    },
    pullRequest: {
      title: "Add review loop",
      description: "Let the model request tools before final output.",
      headSha: "head-sha",
    },
    changedFiles: [],
    platform: {
      gitlab: {
        apiUrl: "https://gitlab.example.test/api/v4",
        projectId: "123",
        mergeRequestIid: "42",
        diffRefs: {
          baseSha: "base-sha",
          startSha: "start-sha",
          headSha: "head-sha",
        },
      },
    },
  };
}
