import { describe, expect, it } from "vitest";

import { parseUnifiedDiffLines } from "../../src/platform/diff-lines.js";

describe("parseUnifiedDiffLines", () => {
  it("does not treat a trailing newline as a context line", () => {
    expect(
      parseUnifiedDiffLines("@@ -1,1 +1,1 @@\n context line\n"),
    ).toEqual([
      {
        kind: "context",
        text: "context line",
        oldLine: 1,
        newLine: 1,
      },
    ]);
  });

  it("preserves genuine blank context lines", () => {
    expect(parseUnifiedDiffLines("@@ -1,2 +1,2 @@\n context line\n \n")).toEqual(
      [
        {
          kind: "context",
          text: "context line",
          oldLine: 1,
          newLine: 1,
        },
        {
          kind: "context",
          text: "",
          oldLine: 2,
          newLine: 2,
        },
      ],
    );
  });
});
