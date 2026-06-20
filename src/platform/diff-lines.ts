/** Parsed line from a unified diff hunk. */
export type DiffLine = {
  kind: "added" | "context" | "deleted";
  text: string;
  oldLine?: number;
  newLine?: number;
};

/** Exact side-specific range matched by copied diff code. */
export type DiffRange = {
  endLine: number;
  startLine: number;
};

/** Parses unified diff text into side-aware line records. */
export function parseUnifiedDiffLines(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine: number | undefined;
  let newLine: number | undefined;

  for (const diffLine of diff.split(/\r?\n/u)) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(diffLine);

    if (hunk !== null) {
      oldLine = readMatchedNumber(hunk, 1);
      newLine = readMatchedNumber(hunk, 2);
      continue;
    }

    if (oldLine === undefined || newLine === undefined) {
      continue;
    }

    if (diffLine.length === 0) {
      continue;
    }

    if (diffLine.startsWith("\\")) {
      continue;
    }

    if (diffLine.startsWith("+")) {
      lines.push({
        kind: "added",
        text: diffLine.slice(1),
        newLine,
      });
      newLine += 1;
      continue;
    }

    if (diffLine.startsWith("-")) {
      lines.push({
        kind: "deleted",
        text: diffLine.slice(1),
        oldLine,
      });
      oldLine += 1;
      continue;
    }

    lines.push({
      kind: "context",
      text: diffLine.startsWith(" ") ? diffLine.slice(1) : diffLine,
      oldLine,
      newLine,
    });
    oldLine += 1;
    newLine += 1;
  }

  return lines;
}

/** Reads exact code covered by a side-specific diff range. */
export function readDiffRangeCode({
  diff,
  endLine,
  side,
  startLine,
}: {
  diff: string;
  endLine: number;
  side: "new" | "old";
  startLine: number;
}): string | undefined {
  const parsedLines = parseUnifiedDiffLines(diff);
  const selectedLines: string[] = [];

  for (let line = startLine; line <= endLine; line += 1) {
    const parsedLine = parsedLines.find((candidate) =>
      side === "new" ? candidate.newLine === line : candidate.oldLine === line,
    );

    if (parsedLine === undefined) {
      return undefined;
    }

    selectedLines.push(parsedLine.text);
  }

  return selectedLines.join("\n");
}

/** Finds the side-specific diff range whose text exactly matches copied code. */
export function findDiffRangeForCode({
  code,
  diff,
  preferredStartLine,
  side,
}: {
  code: string;
  diff: string;
  preferredStartLine?: number;
  side: "new" | "old";
}): DiffRange | undefined {
  const codeLines = code.split(/\r?\n/u);
  const sideLines = parseUnifiedDiffLines(diff).flatMap((line) => {
    const lineNumber = side === "new" ? line.newLine : line.oldLine;

    return lineNumber === undefined
      ? []
      : [
          {
            lineNumber,
            text: line.text,
          },
        ];
  });
  const startIndexes = sideLines
    .map((line, index) => ({
      index,
      isPreferred: line.lineNumber === preferredStartLine,
    }))
    .filter(({ index }) => sideLines[index]?.text === codeLines[0])
    .sort((left, right) => Number(right.isPreferred) - Number(left.isPreferred))
    .map(({ index }) => index);

  for (const startIndex of startIndexes) {
    const startLine = sideLines[startIndex]?.lineNumber;

    if (startLine === undefined) {
      continue;
    }

    const matches = codeLines.every((codeLine, offset) => {
      const sideLine = sideLines[startIndex + offset];

      return (
        sideLine !== undefined &&
        sideLine.lineNumber === startLine + offset &&
        sideLine.text === codeLine
      );
    });

    if (matches) {
      return {
        startLine,
        endLine: startLine + codeLines.length - 1,
      };
    }
  }

  return undefined;
}

function readMatchedNumber(match: RegExpExecArray, index: number): number {
  const value = match[index];

  if (value === undefined) {
    throw new Error(`Expected regex match group ${String(index)}`);
  }

  return Number(value);
}
