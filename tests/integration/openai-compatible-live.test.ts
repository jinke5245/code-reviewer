import { describe, expect, it } from "vitest";

import { createOpenAICompatibleReviewModel } from "../../src/model/openai-compatible.js";

const hasLiveOpenAIEnvironment =
  hasEnvironmentValue("RUN_LIVE_OPENAI_TESTS") &&
  hasEnvironmentValue("OPENAI_API_KEY") &&
  hasEnvironmentValue("OPENAI_MODEL");
const liveIt = hasLiveOpenAIEnvironment ? it : it.skip;

describe("OpenAI-compatible live integration", () => {
  liveIt(
    "completes a minimal request using configured OpenAI environment variables",
    async () => {
      const model = createOpenAICompatibleReviewModel({
        config: {
          provider: "openai-compatible",
          apiKeyEnv: "OPENAI_API_KEY",
        },
        env: process.env,
      });

      const response = await model.complete({
        round: 1,
        maxRounds: 1,
        remainingToolCalls: 0,
        messages: [
          {
            role: "system",
            content: "You are a concise smoke-test assistant.",
          },
          {
            role: "user",
            content:
              "Reply with a short confirmation that the smoke test works.",
          },
        ],
      });

      expect(response.toolCalls ?? []).toEqual([]);
      expect(response.content?.trim().length ?? 0).toBeGreaterThan(0);
    },
    60000,
  );
});

function hasEnvironmentValue(name: string): boolean {
  const value = process.env[name];

  return typeof value === "string" && value.trim().length > 0;
}
