import { describe, expect, it, vi } from "vitest";

import { createOpenAICompatibleReviewModel } from "../../src/model/openai-compatible.js";

describe("createOpenAICompatibleReviewModel", () => {
  it("requests structured review report JSON by default", async () => {
    const requests: RecordedRequest[] = [];
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-4.1",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
      },
      fetch: createFetchMock(requests, {
        choices: [
          {
            message: {
              content: '{"summary":"No findings.","findings":[]}',
            },
          },
        ],
      }),
    });

    await model.complete({
      round: 1,
      maxRounds: 3,
      remainingToolCalls: 0,
      responseFormat: "review_report",
      messages: [
        {
          role: "user",
          content: "Review the merge request.",
        },
      ],
    });

    const requestBody = readRecord(requests[0]?.body, "request body");
    const responseFormat = readRecord(
      requestBody.response_format,
      "response_format",
    );
    const jsonSchema = readRecord(responseFormat.json_schema, "json_schema");
    const schema = readRecord(jsonSchema.schema, "schema");
    const properties = readRecord(schema.properties, "schema.properties");
    const findings = readRecord(properties.findings, "findings property");
    const items = readRecord(findings.items, "findings items");
    const findingProperties = readRecord(
      items.properties,
      "finding properties",
    );

    expect(requestBody).toMatchObject({
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "code_reviewer_report",
          strict: true,
        },
      },
    });
    expect(findingProperties.replacementCode).toEqual({
      type: "string",
    });
    expect(readStringArray(items.required, "finding required")).toContain(
      "replacementCode",
    );
  });

  it("does not request structured output without an explicit final report request", async () => {
    const requests: RecordedRequest[] = [];
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-4.1",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
      },
      fetch: createFetchMock(requests, {
        choices: [
          {
            message: {
              content: "I should inspect more context.",
            },
          },
        ],
      }),
    });

    await model.complete({
      round: 1,
      maxRounds: 3,
      remainingToolCalls: 0,
      messages: [],
    });

    expect(requests[0]?.body).not.toHaveProperty("response_format");
  });

  it("can use JSON object response format or disable response format", async () => {
    const jsonObjectRequests: RecordedRequest[] = [];
    const jsonObjectModel = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-4.1",
        responseFormat: "json_object",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
      },
      fetch: createFetchMock(jsonObjectRequests, {
        choices: [
          {
            message: {
              content: '{"findings":[]}',
            },
          },
        ],
      }),
    });

    await jsonObjectModel.complete({
      round: 1,
      maxRounds: 3,
      remainingToolCalls: 0,
      responseFormat: "review_report",
      messages: [],
    });

    expect(jsonObjectRequests[0]?.body).toMatchObject({
      response_format: {
        type: "json_object",
      },
    });

    const offRequests: RecordedRequest[] = [];
    const offModel = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-4.1",
        responseFormat: "off",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
      },
      fetch: createFetchMock(offRequests, {
        choices: [
          {
            message: {
              content: '{"findings":[]}',
            },
          },
        ],
      }),
    });

    await offModel.complete({
      round: 1,
      maxRounds: 3,
      remainingToolCalls: 0,
      responseFormat: "review_report",
      messages: [],
    });

    expect(offRequests[0]?.body).not.toHaveProperty("response_format");
  });

  it("auto-downgrades final report response format when JSON schema is unsupported", async () => {
    const requests: RecordedRequest[] = [];
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-4.1",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
      },
      fetch: createRecordingFetch(requests, () => {
        const requestBody = readRecord(requests.at(-1)?.body, "request body");
        const responseFormat = readRecord(
          requestBody.response_format,
          "response_format",
        );

        if (responseFormat.type === "json_schema") {
          return new Response(
            JSON.stringify({
              error: {
                message:
                  "response_format json_schema is not supported by this model",
              },
            }),
            {
              status: 400,
              statusText: "Bad Request",
              headers: {
                "content-type": "application/json",
              },
            },
          );
        }

        return jsonResponse({
          choices: [
            {
              message: {
                content: '{"summary":"No findings.","findings":[]}',
              },
            },
          ],
        });
      }),
    });

    await expect(
      model.complete({
        round: 1,
        maxRounds: 3,
        remainingToolCalls: 0,
        responseFormat: "review_report",
        messages: [],
      }),
    ).resolves.toEqual({
      content: '{"summary":"No findings.","findings":[]}',
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.body).toMatchObject({
      response_format: {
        type: "json_schema",
      },
    });
    expect(requests[1]?.body).toMatchObject({
      response_format: {
        type: "json_object",
      },
    });

    await expect(
      model.complete({
        round: 2,
        maxRounds: 3,
        remainingToolCalls: 0,
        responseFormat: "review_report",
        messages: [],
      }),
    ).resolves.toEqual({
      content: '{"summary":"No findings.","findings":[]}',
    });

    expect(requests).toHaveLength(3);
    expect(requests[2]?.body).toMatchObject({
      response_format: {
        type: "json_object",
      },
    });
  });

  it("auto-disables final report response format when JSON object is unsupported", async () => {
    const requests: RecordedRequest[] = [];
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-4.1",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
      },
      fetch: createRecordingFetch(requests, () => {
        const requestBody = readRecord(requests.at(-1)?.body, "request body");

        if (!Object.hasOwn(requestBody, "response_format")) {
          return jsonResponse({
            choices: [
              {
                message: {
                  content: '{"summary":"No findings.","findings":[]}',
                },
              },
            ],
          });
        }

        const responseFormat = readRecord(
          requestBody.response_format,
          "response_format",
        );

        return new Response(
          JSON.stringify({
            error: {
              message: `response_format ${String(responseFormat.type)} is not supported by this model`,
            },
          }),
          {
            status: 400,
            statusText: "Bad Request",
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }),
    });

    await expect(
      model.complete({
        round: 1,
        maxRounds: 3,
        remainingToolCalls: 0,
        responseFormat: "review_report",
        messages: [],
      }),
    ).resolves.toEqual({
      content: '{"summary":"No findings.","findings":[]}',
    });

    expect(requests).toHaveLength(3);
    expect(requests[0]?.body).toMatchObject({
      response_format: {
        type: "json_schema",
      },
    });
    expect(requests[1]?.body).toMatchObject({
      response_format: {
        type: "json_object",
      },
    });
    expect(requests[2]?.body).not.toHaveProperty("response_format");

    await expect(
      model.complete({
        round: 2,
        maxRounds: 3,
        remainingToolCalls: 0,
        responseFormat: "review_report",
        messages: [],
      }),
    ).resolves.toEqual({
      content: '{"summary":"No findings.","findings":[]}',
    });

    expect(requests).toHaveLength(4);
    expect(requests[3]?.body).not.toHaveProperty("response_format");
  });

  it("sends chat completion requests using explicit config before OpenAI env defaults", async () => {
    const requests: RecordedRequest[] = [];
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        baseUrl: "https://gateway.example.test/v1",
        apiKeyEnv: "MODEL_TOKEN",
        model: "qwen-coder",
        temperature: 0.2,
        maxOutputTokens: 1024,
        timeoutMs: 90000,
      },
      env: {
        MODEL_TOKEN: "config-secret",
        OPENAI_API_KEY: "openai-secret",
        OPENAI_BASE_URL: "https://api.openai.test/v1",
        OPENAI_MODEL: "gpt-env",
        OPENAI_ORG_ID: "org_123",
        OPENAI_PROJECT_ID: "proj_123",
      },
      fetch: createFetchMock(requests, {
        choices: [
          {
            message: {
              content: '{"findings":[]}',
            },
          },
        ],
      }),
    });

    await expect(
      model.complete({
        round: 1,
        maxRounds: 3,
        remainingToolCalls: 2,
        messages: [
          {
            role: "system",
            content: "You are a reviewer.",
          },
          {
            role: "user",
            content: "Review the merge request.",
          },
        ],
      }),
    ).resolves.toEqual({
      content: '{"findings":[]}',
    });

    expect(requests).toMatchObject([
      {
        url: "https://gateway.example.test/v1/chat/completions",
        authorization: "Bearer config-secret",
        organization: "org_123",
        project: "proj_123",
        body: {
          model: "qwen-coder",
          messages: [
            {
              role: "system",
              content: "You are a reviewer.",
            },
            {
              role: "user",
              content: "Review the merge request.",
            },
          ],
          temperature: 0.2,
          max_tokens: 1024,
        },
      },
    ]);
  });

  it("enforces the configured model request timeout", async () => {
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-4.1",
        timeoutMs: 5,
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
      },
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;

          if (signal === undefined || signal === null) {
            reject(new Error("Missing request abort signal"));
            return;
          }

          signal.addEventListener(
            "abort",
            () => {
              reject(new Error("request aborted by timeout"));
            },
            {
              once: true,
            },
          );
        }),
    });

    await expect(
      model.complete({
        round: 1,
        maxRounds: 3,
        remainingToolCalls: 0,
        messages: [],
      }),
    ).rejects.toThrow(/request aborted by timeout|timed out/i);
  }, 5000);

  it("falls back to OpenAI environment variables for base URL and model", async () => {
    const requests: RecordedRequest[] = [];
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
        OPENAI_BASE_URL: "https://openai-compatible.example.test/v1",
        OPENAI_MODEL: "gpt-4.1",
      },
      fetch: createFetchMock(requests, {
        choices: [
          {
            message: {
              content: "No findings.",
            },
          },
        ],
      }),
    });

    await expect(
      model.complete({
        round: 1,
        maxRounds: 3,
        remainingToolCalls: 0,
        messages: [
          {
            role: "user",
            content: "Review the merge request.",
          },
        ],
      }),
    ).resolves.toEqual({
      content: "No findings.",
    });

    expect(requests[0]?.url).toBe(
      "https://openai-compatible.example.test/v1/chat/completions",
    );
    expect(requests[0]?.authorization).toBe("Bearer openai-secret");
    expect(requests[0]?.body).toMatchObject({
      model: "gpt-4.1",
    });
  });

  it("trims OpenAI environment values and normalizes trailing base URL slashes", async () => {
    const requests: RecordedRequest[] = [];
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
      },
      env: {
        OPENAI_API_KEY: "  openai-secret  ",
        OPENAI_BASE_URL: " https://openai-compatible.example.test/v1/// ",
        OPENAI_MODEL: "  gpt-4.1  ",
      },
      fetch: createFetchMock(requests, {
        choices: [
          {
            message: {
              content: "No findings.",
            },
          },
        ],
      }),
    });

    await model.complete({
      round: 1,
      maxRounds: 3,
      remainingToolCalls: 0,
      messages: [
        {
          role: "user",
          content: "Review the merge request.",
        },
      ],
    });

    expect(requests[0]).toMatchObject({
      url: "https://openai-compatible.example.test/v1/chat/completions",
      authorization: "Bearer openai-secret",
      body: {
        model: "gpt-4.1",
      },
    });
  });

  it("normalizes protocol-relative OpenAI-compatible base URLs from the environment", async () => {
    const requests: RecordedRequest[] = [];
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
        OPENAI_BASE_URL: "//model.example.test/v1/",
        OPENAI_MODEL: "gpt-4.1",
      },
      fetch: createFetchMock(requests, {
        choices: [
          {
            message: {
              content: "No findings.",
            },
          },
        ],
      }),
    });

    await model.complete({
      round: 1,
      maxRounds: 3,
      remainingToolCalls: 0,
      messages: [
        {
          role: "user",
          content: "Review the merge request.",
        },
      ],
    });

    expect(requests[0]?.url).toBe(
      "https://model.example.test/v1/chat/completions",
    );
  });

  it("retries root OpenAI-compatible base URLs with /v1 after a 404", async () => {
    const requests: RecordedRequest[] = [];
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
        OPENAI_BASE_URL: "https://model.example.test/gateway",
        OPENAI_MODEL: "gpt-4.1",
      },
      fetch: (input, init) => {
        const url = fetchInputUrl(input);

        if (url === "https://model.example.test/gateway/chat/completions") {
          return Promise.resolve(
            new Response("not found", {
              status: 404,
              statusText: "Not Found",
            }),
          );
        }

        return createFetchMock(requests, {
          choices: [
            {
              message: {
                content: "No findings.",
              },
            },
          ],
        })(input, init);
      },
    });

    await expect(
      model.complete({
        round: 1,
        maxRounds: 3,
        remainingToolCalls: 0,
        messages: [
          {
            role: "user",
            content: "Review the merge request.",
          },
        ],
      }),
    ).resolves.toEqual({
      content: "No findings.",
    });

    expect(requests[0]?.url).toBe(
      "https://model.example.test/gateway/v1/chat/completions",
    );
  });

  it("retries transient 429 responses for the same chat completion request", async () => {
    const requests: string[] = [];
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
        OPENAI_BASE_URL: "https://model.example.test/v1",
        OPENAI_MODEL: "gpt-4.1",
      },
      fetch: (input, init) => {
        requests.push(fetchInputUrl(input));

        if (requests.length === 1) {
          return Promise.resolve(
            new Response("rate limited", {
              headers: {
                "retry-after": "0",
              },
              status: 429,
              statusText: "Too Many Requests",
            }),
          );
        }

        return createFetchMock([], {
          choices: [
            {
              message: {
                content: "Retried successfully.",
              },
            },
          ],
        })(input, init);
      },
    });

    await expect(
      model.complete({
        round: 1,
        maxRounds: 3,
        remainingToolCalls: 0,
        messages: [
          {
            role: "user",
            content: "Review the merge request.",
          },
        ],
      }),
    ).resolves.toEqual({
      content: "Retried successfully.",
    });
    expect(requests).toEqual([
      "https://model.example.test/v1/chat/completions",
      "https://model.example.test/v1/chat/completions",
    ]);
  });

  it("retries empty choices responses for the same chat completion request", async () => {
    const requests: string[] = [];
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
        OPENAI_BASE_URL: "https://model.example.test/v1",
        OPENAI_MODEL: "gpt-4.1",
      },
      fetch: (input, init) => {
        requests.push(fetchInputUrl(input));

        if (requests.length === 1) {
          return Promise.resolve(
            jsonResponse({
              choices: [],
            }),
          );
        }

        return createFetchMock([], {
          choices: [
            {
              message: {
                content: "Retried successfully.",
              },
            },
          ],
        })(input, init);
      },
    });

    await expect(
      model.complete({
        round: 1,
        maxRounds: 3,
        remainingToolCalls: 0,
        messages: [
          {
            role: "user",
            content: "Review the merge request.",
          },
        ],
      }),
    ).resolves.toEqual({
      content: "Retried successfully.",
    });
    expect(requests).toEqual([
      "https://model.example.test/v1/chat/completions",
      "https://model.example.test/v1/chat/completions",
    ]);
  });

  it("does not retry non-transient chat completion errors", async () => {
    const requests: string[] = [];
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
        OPENAI_BASE_URL: "https://model.example.test/v1",
        OPENAI_MODEL: "gpt-4.1",
      },
      fetch: (input) => {
        requests.push(fetchInputUrl(input));

        return Promise.resolve(
          new Response("unauthorized", {
            status: 401,
            statusText: "Unauthorized",
          }),
        );
      },
    });

    await expect(
      model.complete({
        round: 1,
        maxRounds: 3,
        remainingToolCalls: 0,
        messages: [
          {
            role: "user",
            content: "Review the merge request.",
          },
        ],
      }),
    ).rejects.toThrow(/Model request failed: 401 Unauthorized/);
    expect(requests).toEqual([
      "https://model.example.test/v1/chat/completions",
    ]);
  });

  it("does not retry root base URLs when the 404 response body cannot be read", async () => {
    const requests: string[] = [];
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
        OPENAI_BASE_URL: "https://model.example.test/gateway",
        OPENAI_MODEL: "gpt-4.1",
      },
      fetch: (input) => {
        requests.push(fetchInputUrl(input));
        const response = new Response("not found", {
          status: 404,
          statusText: "Not Found",
        });

        vi.spyOn(response, "clone").mockImplementation(() => {
          throw new Error("Cannot clone response body");
        });

        return Promise.resolve(response);
      },
    });

    await expect(
      model.complete({
        round: 1,
        maxRounds: 3,
        remainingToolCalls: 0,
        messages: [
          {
            role: "user",
            content: "Review the merge request.",
          },
        ],
      }),
    ).rejects.toThrow(/Model request failed: 404 Not Found/);
    expect(requests).toEqual([
      "https://model.example.test/gateway/chat/completions",
    ]);
  });

  it("does not retry versioned base URLs for model-not-found 404 errors", async () => {
    const requests: string[] = [];
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
        OPENAI_BASE_URL: "https://model.example.test/gateway",
        OPENAI_MODEL: "missing-model",
      },
      fetch: (input) => {
        requests.push(fetchInputUrl(input));

        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                message: "The model `missing-model` does not exist.",
                type: "invalid_request_error",
                code: "model_not_found",
              },
            }),
            {
              headers: {
                "content-type": "application/json",
              },
              status: 404,
              statusText: "Not Found",
            },
          ),
        );
      },
    });

    await expect(
      model.complete({
        round: 1,
        maxRounds: 3,
        remainingToolCalls: 0,
        messages: [
          {
            role: "user",
            content: "Review the merge request.",
          },
        ],
      }),
    ).rejects.toThrow(/Model request failed: 404 Not Found/);
    expect(requests).toEqual([
      "https://model.example.test/gateway/chat/completions",
    ]);
  });

  it("does not expose API error response bodies on thrown errors", async () => {
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
        OPENAI_BASE_URL: "https://model.example.test/gateway",
        OPENAI_MODEL: "missing-model",
      },
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                message: "The model `missing-model` does not exist.",
                code: "model_not_found",
              },
            }),
            {
              headers: {
                "content-type": "application/json",
              },
              status: 404,
              statusText: "Not Found",
            },
          ),
        ),
    });

    let thrown: unknown;

    try {
      await model.complete({
        round: 1,
        maxRounds: 3,
        remainingToolCalls: 0,
        messages: [
          {
            role: "user",
            content: "Review the merge request.",
          },
        ],
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(Object.keys((thrown as Error).cause as object)).not.toContain(
      "responseBody",
    );
    expect(JSON.stringify((thrown as Error).cause)).not.toContain(
      "missing-model",
    );
  });

  it("wraps errors from the versioned base URL retry", async () => {
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
        OPENAI_BASE_URL: "https://model.example.test/gateway",
        OPENAI_MODEL: "gpt-4.1",
      },
      fetch: (input) => {
        const url = fetchInputUrl(input);

        if (url === "https://model.example.test/gateway/chat/completions") {
          return Promise.resolve(
            new Response("not found", {
              status: 404,
              statusText: "Not Found",
            }),
          );
        }

        return Promise.resolve(
          new Response("unauthorized", {
            status: 401,
            statusText: "Unauthorized",
          }),
        );
      },
    });

    await expect(
      model.complete({
        round: 1,
        maxRounds: 3,
        remainingToolCalls: 0,
        messages: [
          {
            role: "user",
            content: "Review the merge request.",
          },
        ],
      }),
    ).rejects.toThrow(/Model request failed: 401 Unauthorized/);
  });

  it("parses native OpenAI tool call responses", async () => {
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-4.1",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
      },
      fetch: createFetchMock([], {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "call_123",
                  type: "function",
                  function: {
                    name: "read_diff",
                    arguments: JSON.stringify({
                      path: "src/index.ts",
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
    });

    await expect(
      model.complete({
        round: 1,
        maxRounds: 3,
        remainingToolCalls: 1,
        messages: [
          {
            role: "user",
            content: "Review the merge request.",
          },
        ],
      }),
    ).resolves.toEqual({
      toolCalls: [
        {
          id: "call_123",
          name: "read_diff",
          arguments: {
            path: "src/index.ts",
          },
        },
      ],
    });
  });

  it("sends native tool definitions when they are configured and tool calls remain", async () => {
    const requests: RecordedRequest[] = [];
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-4.1",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
      },
      tools: [
        {
          type: "function",
          function: {
            name: "read_diff",
            description: "Read a changed file diff.",
            parameters: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                },
              },
              required: ["path"],
            },
          },
        },
      ],
      fetch: createFetchMock(requests, {
        choices: [
          {
            message: {
              content: "No findings.",
            },
          },
        ],
      }),
    });

    await model.complete({
      round: 1,
      maxRounds: 3,
      remainingToolCalls: 1,
      messages: [
        {
          role: "user",
          content: "Review the merge request.",
        },
      ],
    });

    expect(requests[0]?.body).toMatchObject({
      tools: [
        {
          type: "function",
          function: {
            name: "read_diff",
          },
        },
      ],
      tool_choice: "auto",
    });
    expect(requests[0]?.body).not.toHaveProperty("response_format");
  });

  it("does not send tool definitions when no tool calls remain", async () => {
    const requests: RecordedRequest[] = [];
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-4.1",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
      },
      tools: [
        {
          type: "function",
          function: {
            name: "read_diff",
          },
        },
      ],
      fetch: createFetchMock(requests, {
        choices: [
          {
            message: {
              content: "No findings.",
            },
          },
        ],
      }),
    });

    await model.complete({
      round: 2,
      maxRounds: 3,
      remainingToolCalls: 0,
      messages: [
        {
          role: "user",
          content: "Review the merge request.",
        },
      ],
    });

    expect(requests[0]?.body).not.toHaveProperty("tools");
    expect(requests[0]?.body).not.toHaveProperty("tool_choice");
  });

  it("serializes assistant tool calls and tool results for follow-up requests", async () => {
    const requests: RecordedRequest[] = [];
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-4.1",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
      },
      fetch: createFetchMock(requests, {
        choices: [
          {
            message: {
              content: "No findings.",
            },
          },
        ],
      }),
    });

    await model.complete({
      round: 2,
      maxRounds: 3,
      remainingToolCalls: 1,
      messages: [
        {
          role: "assistant",
          content: "I need file context.",
          toolCalls: [
            {
              id: "call_123",
              name: "read_file",
              arguments: {
                path: "src/index.ts",
              },
            },
          ],
        },
        {
          role: "tool",
          toolCallId: "call_123",
          name: "read_file",
          content: '{"path":"src/index.ts","content":"export {}"}',
        },
        {
          role: "tool",
          name: "repo_search",
          content: '{"matches":[]}',
        },
      ],
    });

    expect(requests[0]?.body).toMatchObject({
      messages: [
        {
          role: "assistant",
          content: "I need file context.",
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: {
                name: "read_file",
                arguments: JSON.stringify({
                  path: "src/index.ts",
                }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_123",
          content: '{"path":"src/index.ts","content":"export {}"}',
        },
        {
          role: "user",
          content: 'Tool result from repo_search:\n{"matches":[]}',
        },
      ],
    });
  });

  it("reports missing API key and missing model clearly", () => {
    expect(() =>
      createOpenAICompatibleReviewModel({
        config: {
          provider: "openai-compatible",
          apiKeyEnv: "OPENAI_API_KEY",
          model: "gpt-4.1",
        },
        env: {},
      }),
    ).toThrow(/Missing OpenAI-compatible API key: set OPENAI_API_KEY/);

    expect(() =>
      createOpenAICompatibleReviewModel({
        config: {
          provider: "openai-compatible",
          apiKeyEnv: "OPENAI_API_KEY",
        },
        env: {
          OPENAI_API_KEY: "openai-secret",
        },
      }),
    ).toThrow(
      /Missing OpenAI-compatible model: set model\.model or OPENAI_MODEL/,
    );

    expect(() =>
      createOpenAICompatibleReviewModel({
        config: {
          provider: "openai-compatible",
          apiKeyEnv: "OPENAI_API_KEY",
        },
        env: {
          OPENAI_API_KEY: "   ",
          OPENAI_MODEL: "gpt-4.1",
        },
      }),
    ).toThrow(/Missing OpenAI-compatible API key: set OPENAI_API_KEY/);
  });

  it("reports HTTP and response JSON errors clearly", async () => {
    const failedModel = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-4.1",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
      },
      fetch: () =>
        Promise.resolve(
          new Response("unavailable", {
            status: 503,
            statusText: "Service Unavailable",
          }),
        ),
    });

    await expect(
      failedModel.complete({
        round: 1,
        maxRounds: 3,
        remainingToolCalls: 0,
        messages: [],
      }),
    ).rejects.toThrow(/Model request failed: 503 Service Unavailable/);

    const invalidJsonModel = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-4.1",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
      },
      fetch: () =>
        Promise.resolve(
          new Response("not json", {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          }),
        ),
    });

    await expect(
      invalidJsonModel.complete({
        round: 1,
        maxRounds: 3,
        remainingToolCalls: 0,
        messages: [],
      }),
    ).rejects.toThrow(/Model request failed:/);
  });

  it("reports structurally invalid model responses clearly", async () => {
    const emptyChoicesModel = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-4.1",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
      },
      fetch: createFetchMock([], {
        choices: [],
      }),
    });

    await expect(
      emptyChoicesModel.complete({
        round: 1,
        maxRounds: 3,
        remainingToolCalls: 0,
        messages: [],
      }),
    ).rejects.toThrow(/Invalid model response: choices: Too small/);

    const missingContentModel = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-4.1",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
      },
      fetch: createFetchMock([], {
        choices: [
          {
            message: {},
          },
        ],
      }),
    });

    await expect(
      missingContentModel.complete({
        round: 1,
        maxRounds: 3,
        remainingToolCalls: 0,
        messages: [],
      }),
    ).rejects.toThrow(
      /Invalid model response: choices\.0\.message must include content or tool_calls/,
    );
  });

  it("reports invalid native tool argument JSON clearly", async () => {
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-4.1",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
      },
      fetch: createFetchMock([], {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "call_bad_json",
                  type: "function",
                  function: {
                    name: "read_diff",
                    arguments: "{",
                  },
                },
              ],
            },
          },
        ],
      }),
    });

    await expect(
      model.complete({
        round: 1,
        maxRounds: 3,
        remainingToolCalls: 1,
        messages: [],
      }),
    ).rejects.toThrow(/Cannot parse tool arguments JSON for read_diff/);
  });
});

type RecordedRequest = {
  url: string;
  authorization: string | null;
  organization: string | null;
  project: string | null;
  stainlessTimeout: string | null;
  body: unknown;
};

function createFetchMock(
  requests: RecordedRequest[],
  responseBody: unknown,
): typeof fetch {
  return createRecordingFetch(requests, () => jsonResponse(responseBody));
}

function createRecordingFetch(
  requests: RecordedRequest[],
  respond: () => Response,
): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    const requestBody = init?.body;

    if (typeof requestBody !== "string") {
      throw new Error("Expected JSON string request body");
    }

    requests.push({
      url: fetchInputUrl(input),
      authorization: headers.get("authorization"),
      organization: headers.get("openai-organization"),
      project: headers.get("openai-project"),
      stainlessTimeout: headers.get("x-stainless-timeout"),
      body: JSON.parse(requestBody) as unknown,
    });

    return Promise.resolve(respond());
  };
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object`);
  }

  return value as Record<string, unknown>;
}

function readStringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error(`Expected ${label} to be a string array`);
  }

  return value;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
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
