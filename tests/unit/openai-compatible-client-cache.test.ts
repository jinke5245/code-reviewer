import { afterEach, describe, expect, it, vi } from "vitest";

describe("OpenAI-compatible client caching", () => {
  afterEach(() => {
    vi.doUnmock("openai");
  });

  it("reuses one OpenAI client for multiple requests to the same base URL", async () => {
    const constructorOptions: unknown[] = [];

    class MockOpenAI {
      readonly chat = {
        completions: {
          create: () =>
            Promise.resolve({
              choices: [
                {
                  message: {
                    content: '{"summary":"No findings.","findings":[]}',
                  },
                },
              ],
            }),
        },
      };

      constructor(options: unknown) {
        constructorOptions.push(options);
      }
    }

    vi.resetModules();
    vi.doMock("openai", () => ({
      default: MockOpenAI,
    }));

    const { createOpenAICompatibleReviewModel } =
      await import("../../src/model/openai-compatible.js");
    const model = createOpenAICompatibleReviewModel({
      config: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
        baseUrl: "https://openai.example.test/v1",
        model: "gpt-4.1",
      },
      env: {
        OPENAI_API_KEY: "openai-secret",
      },
    });
    const request = {
      round: 1,
      maxRounds: 3,
      remainingToolCalls: 0,
      responseFormat: "review_report" as const,
      messages: [],
    };

    await model.complete(request);
    await model.complete(request);

    expect(constructorOptions).toHaveLength(1);
  });
});
