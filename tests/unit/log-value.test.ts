import { describe, expect, it } from "vitest";

import { stringifyLogValue } from "../../src/log-value.js";

describe("stringifyLogValue", () => {
  it("formats non-JSON runtime values for log output", () => {
    function fn(): string {
      return "value";
    }
    const symbol = Symbol("value");

    expect(stringifyLogValue(undefined)).toBe("undefined");
    expect(stringifyLogValue(1n)).toBe("1");
    expect(stringifyLogValue(fn)).toContain("function");
    expect(stringifyLogValue(symbol)).toBe("Symbol(value)");
  });

  it("uses JSON serialization for ordinary log values", () => {
    expect(
      stringifyLogValue({
        nested: {
          value: true,
        },
      }),
    ).toBe('{"nested":{"value":true}}');
  });
});
