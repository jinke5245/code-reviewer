import { describe, expect, it } from "vitest";

import { readRequiredEnvironmentValue } from "../../src/env.js";
import { formatErrorMessage } from "../../src/tools/format-error.js";

describe("readRequiredEnvironmentValue", () => {
  it("returns configured environment values without trimming significant whitespace", () => {
    expect(
      readRequiredEnvironmentValue(
        {
          REVIEW_TOKEN: "  token-value  ",
        },
        "REVIEW_TOKEN",
        "review token",
      ),
    ).toBe("  token-value  ");
  });

  it("rejects missing and blank environment values with the configured label", () => {
    expect(() =>
      readRequiredEnvironmentValue({}, "REVIEW_TOKEN", "review token"),
    ).toThrow(/Missing review token: REVIEW_TOKEN/);
    expect(() =>
      readRequiredEnvironmentValue(
        {
          REVIEW_TOKEN: "   ",
        },
        "REVIEW_TOKEN",
        "review token",
      ),
    ).toThrow(/Missing review token: REVIEW_TOKEN/);
  });
});

describe("formatErrorMessage", () => {
  it("formats Error instances and non-Error throwables consistently", () => {
    expect(formatErrorMessage(new Error("boom"))).toBe("boom");
    expect(formatErrorMessage("plain failure")).toBe("plain failure");
  });
});
