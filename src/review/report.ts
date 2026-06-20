import { z, ZodError } from "zod";

import {
  findDiffRangeForCode,
  readDiffRangeCode,
} from "../platform/diff-lines.js";
import type { DiffSide, ReviewTargetContext } from "../platform/types.js";
import type { ReviewPromptSummary } from "../prompt/review-prompts.js";
import { formatErrorMessage } from "../tools/format-error.js";

/** Severity levels accepted in structured review findings. */
export type ReviewFindingSeverity = "low" | "medium" | "high";

/** Diff side accepted in structured review findings. */
export type ReviewFindingSide = DiffSide;

/** Actionable issue reported by the review model. */
export type ReviewFinding = {
  path: string;
  side: ReviewFindingSide;
  startLine: number;
  endLine: number;
  code: string;
  severity: ReviewFindingSeverity;
  title: string;
  body: string;
  suggestion: string;
  replacementCode: string;
};

/** Lightweight record of a tool call included in final report metadata. */
export type ReviewToolCallSummary = {
  id?: string;
  name: string;
};

/** Normalized review report used for publishing and dry-run output. */
export type ReviewReport = {
  summary: string;
  findings: ReviewFinding[];
  promptSummary?: ReviewPromptSummary;
  toolCalls: ReviewToolCallSummary[];
};

/** Inputs required to parse and normalize model output. */
export type ParseReviewReportOptions = {
  content: string;
  context: ReviewTargetContext;
  promptSummary?: ReviewPromptSummary;
  toolCalls?: ReviewToolCallSummary[];
};

const findingSchema = z
  .object({
    path: z.string().min(1),
    side: z.enum(["new", "old"]),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    code: z.string().min(1),
    severity: z.enum(["low", "medium", "high"]),
    title: z.string().min(1),
    body: z.string().min(1),
    suggestion: z.string(),
    replacementCode: z.string(),
  })
  .strict()
  .refine((finding) => finding.endLine >= finding.startLine, {
    path: ["endLine"],
    message: "must be greater than or equal to startLine",
  });

const modelReportSchema = z
  .object({
    summary: z.string().min(1),
    findings: z.array(findingSchema).default([]),
  })
  .strict();

type ModelReviewReport = z.infer<typeof modelReportSchema>;
type JsonObjectExtractionResult =
  | {
      found: true;
      value: unknown;
    }
  | {
      found: false;
    };

/** Parses model JSON output into canonical, normalized review findings. */
export function parseReviewReport({
  content,
  context,
  promptSummary,
  toolCalls = [],
}: ParseReviewReportOptions): ReviewReport {
  const modelReport = parseModelReviewReport(parseReviewReportJson(content));
  validateReviewFindingEvidence(modelReport.findings, context);

  return {
    summary: modelReport.summary,
    findings: modelReport.findings,
    ...(promptSummary === undefined ? {} : { promptSummary }),
    toolCalls,
  };
}

function parseReviewReportJson(content: string): unknown {
  const trimmedContent = content.trim();

  try {
    return JSON.parse(trimmedContent) as unknown;
  } catch (error) {
    const extractedJson = extractSingleJsonObjectFromText(trimmedContent);

    if (extractedJson.found) {
      return extractedJson.value;
    }

    throw new Error(
      `Cannot parse review report JSON: ${formatErrorMessage(error)}`,
      {
        cause: error,
      },
    );
  }
}

function extractSingleJsonObjectFromText(
  content: string,
): JsonObjectExtractionResult {
  const candidates: unknown[] = [];
  let startIndex: number | undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (character === undefined) {
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{") {
      if (depth === 0) {
        startIndex = index;
      }
      depth += 1;
      continue;
    }

    if (character !== "}" || depth === 0) {
      continue;
    }

    depth -= 1;

    if (depth === 0 && startIndex !== undefined) {
      const candidate = extractJsonObjectCandidate(
        content.slice(startIndex, index + 1),
      );

      if (candidate.found) {
        candidates.push(candidate.value);
      }

      startIndex = undefined;
    }
  }

  return candidates.length === 1
    ? {
        found: true,
        value: candidates[0],
      }
    : {
        found: false,
      };
}

function extractJsonObjectCandidate(
  candidate: string,
): JsonObjectExtractionResult {
  try {
    const parsed = JSON.parse(candidate) as unknown;

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {
        found: false,
      };
    }

    return {
      found: true,
      value: parsed,
    };
  } catch {
    return {
      found: false,
    };
  }
}

function parseModelReviewReport(rawReport: unknown): ModelReviewReport {
  try {
    return modelReportSchema.parse(rawReport);
  } catch (error) {
    if (error instanceof ZodError) {
      const issueSummary = error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
          return `${path}: ${issue.message}`;
        })
        .join("; ");
      throw new Error(`Invalid review report: ${issueSummary}`, {
        cause: error,
      });
    }

    throw error;
  }
}

function validateReviewFindingEvidence(
  findings: ReviewFinding[],
  context: ReviewTargetContext,
): void {
  for (const [index, finding] of findings.entries()) {
    const changedFile = context.changedFiles.find(
      (file) => file.newPath === finding.path || file.oldPath === finding.path,
    );

    if (changedFile === undefined) {
      throw new Error(
        `Invalid review report: findings.${String(index)} code range not found in merge request diff for ${finding.path}:${formatFindingRange(finding)} (${finding.side})`,
      );
    }

    const diffCode = readDiffRangeCode({
      diff: changedFile.diff,
      endLine: finding.endLine,
      side: finding.side,
      startLine: finding.startLine,
    });

    if (diffCode === undefined) {
      throw new Error(
        `Invalid review report: findings.${String(index)} code range not found in merge request diff for ${finding.path}:${formatFindingRange(finding)} (${finding.side})`,
      );
    }

    if (!isReviewFindingCodeEquivalent(diffCode, finding.code)) {
      const matchedRange = findDiffRangeForCode({
        code: finding.code,
        diff: changedFile.diff,
        preferredStartLine: finding.startLine,
        side: finding.side,
      });
      throw new Error(
        [
          `Invalid review report: findings.${String(index)} code does not match selected diff range for ${finding.path}:${formatFindingRange(finding)} (${finding.side})`,
          `expected ${JSON.stringify(diffCode)}`,
          `received ${JSON.stringify(finding.code)}`,
          ...(matchedRange === undefined
            ? []
            : [
                `received code matches diff range for ${finding.path}:${formatLineRange(matchedRange.startLine, matchedRange.endLine)} (${finding.side})`,
              ]),
        ].join("; "),
      );
    }
  }
}

function formatFindingRange(finding: ReviewFinding): string {
  return formatLineRange(finding.startLine, finding.endLine);
}

function formatLineRange(startLine: number, endLine: number): string {
  return startLine === endLine
    ? String(startLine)
    : `${String(startLine)}-${String(endLine)}`;
}

function isReviewFindingCodeEquivalent(
  expectedCode: string,
  receivedCode: string,
): boolean {
  if (expectedCode === receivedCode) {
    return true;
  }

  const normalizedExpected = removeWhitespace(expectedCode);

  return (
    normalizedExpected.length > 0 &&
    normalizedExpected === removeWhitespace(receivedCode)
  );
}

function removeWhitespace(code: string): string {
  return code.replace(/\s+/gu, "");
}
