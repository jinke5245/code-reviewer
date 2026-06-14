import { createHash } from "node:crypto";

import type {
  GitLabDiffFile,
  GitLabMergeRequestContext,
} from "./mr-context.js";
import { parseGitLabDiffLines } from "./diff-lines.js";
import type {
  ReviewFinding,
  ReviewFindingSeverity,
  ReviewReport,
} from "../review/report.js";

type GitLabLineRangePoint = {
  type: "new" | "old";
  lineCode: string;
  oldLine?: number;
  newLine?: number;
};

type GitLabLineRange = {
  start: GitLabLineRangePoint;
  end: GitLabLineRangePoint;
};

/** GitLab text diff position payload used when creating inline discussions. */
export type GitLabTextPosition = {
  positionType: "text";
  baseSha: string;
  startSha: string;
  headSha: string;
  oldPath: string;
  newPath: string;
  oldLine?: number;
  newLine?: number;
  lineRange?: GitLabLineRange;
};

/** A finding that can be published as a GitLab inline discussion. */
export type ReviewInlineFinding = {
  finding: ReviewFinding;
  position: GitLabTextPosition;
};

/** Publish mode used for this review run. */
export type ReviewPublishMode = "dry-run" | "summary" | "inline";

/** Program-derived overview for one review run. */
export type ReviewRunOverview = {
  changedFiles: number;
  commit: string;
  findings: number;
  highestSeverity: ReviewFindingSeverity | "none";
  inlineFindings: number;
  publishMode: ReviewPublishMode;
  unmappedFindings: number;
};

/** A deterministic publication plan derived from normalized review findings. */
export type ReviewPublicationPlan = {
  overview: ReviewRunOverview;
  summary: string;
  findings: ReviewFinding[];
  inlineFindings: ReviewInlineFinding[];
  unmappedFindings: ReviewFinding[];
  promptSummary?: ReviewReport["promptSummary"];
  toolCalls: ReviewReport["toolCalls"];
};

/** Options for creating a review publication plan. */
export type CreateReviewPublicationPlanOptions = {
  context: GitLabMergeRequestContext;
  publishMode: ReviewPublishMode;
  report: ReviewReport;
};

/** Options for mapping a finding to a GitLab diff position. */
export type MapFindingToDiffPositionOptions = {
  context: GitLabMergeRequestContext;
  finding: ReviewFinding;
};

type PositionCandidate = {
  kind: "added" | "context" | "deleted";
  oldLine?: number;
  newLine?: number;
};

const severityRank: Record<ReviewFindingSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

/** Derives the GitLab publishing shape from canonical review findings. */
export function createReviewPublicationPlan({
  context,
  publishMode,
  report,
}: CreateReviewPublicationPlanOptions): ReviewPublicationPlan {
  const inlineFindings: ReviewInlineFinding[] = [];
  const unmappedFindings: ReviewFinding[] = [];

  for (const finding of report.findings) {
    const position = mapFindingToDiffPosition({
      context,
      finding,
    });

    if (position === undefined) {
      unmappedFindings.push(finding);
    } else {
      inlineFindings.push({
        finding,
        position,
      });
    }
  }

  return {
    overview: {
      commit: context.mergeRequest.diffRefs.headSha,
      changedFiles: context.changedFiles.length,
      findings: report.findings.length,
      highestSeverity: findHighestSeverity(report.findings),
      inlineFindings: inlineFindings.length,
      unmappedFindings: unmappedFindings.length,
      publishMode,
    },
    summary: report.summary,
    findings: report.findings,
    inlineFindings,
    unmappedFindings,
    ...(report.promptSummary === undefined
      ? {}
      : { promptSummary: report.promptSummary }),
    toolCalls: report.toolCalls,
  };
}

function findHighestSeverity(
  findings: ReviewFinding[],
): ReviewFindingSeverity | "none" {
  const highest = findings.reduce<ReviewFindingSeverity | undefined>(
    (current, finding) =>
      current === undefined ||
      severityRank[finding.severity] > severityRank[current]
        ? finding.severity
        : current,
    undefined,
  );

  return highest ?? "none";
}

/** Maps a review finding to the best available GitLab diff position. */
export function mapFindingToDiffPosition({
  context,
  finding,
}: MapFindingToDiffPositionOptions): GitLabTextPosition | undefined {
  const changedFile = context.changedFiles.find(
    (file) => file.newPath === finding.path || file.oldPath === finding.path,
  );

  if (changedFile === undefined) {
    return undefined;
  }

  const candidates = collectPositionCandidates({
    file: changedFile,
    line: finding.startLine,
    side: finding.side,
  });
  const startCandidate = selectBestSingleLineCandidate(
    candidates,
    finding.side,
  );

  if (startCandidate === undefined) {
    return undefined;
  }

  const endCandidates = collectPositionCandidates({
    file: changedFile,
    line: finding.endLine,
    side: finding.side,
  });
  const rangePosition = createRangePosition({
    context,
    side: finding.side,
    file: changedFile,
    startCandidate,
    endCandidates,
  });

  return (
    rangePosition ??
    createPosition({
      context,
      file: changedFile,
      oldLine: startCandidate.oldLine,
      newLine: startCandidate.newLine,
    })
  );
}

function collectPositionCandidates({
  file,
  line,
  side,
}: {
  file: GitLabDiffFile;
  line: number;
  side: ReviewFinding["side"];
}): PositionCandidate[] {
  const candidates: PositionCandidate[] = [];
  for (const diffLine of parseGitLabDiffLines(file.diff)) {
    const matchesLine =
      side === "new" ? diffLine.newLine === line : diffLine.oldLine === line;

    if (matchesLine) {
      candidates.push({
        kind: diffLine.kind,
        ...(diffLine.oldLine === undefined
          ? {}
          : { oldLine: diffLine.oldLine }),
        ...(diffLine.newLine === undefined
          ? {}
          : { newLine: diffLine.newLine }),
      });
    }
  }

  return candidates;
}

function selectBestSingleLineCandidate(
  candidates: PositionCandidate[],
  side: ReviewFinding["side"],
): PositionCandidate | undefined {
  if (side === "old") {
    return (
      candidates.find((candidate) => candidate.kind === "deleted") ??
      candidates.find((candidate) => candidate.kind === "context")
    );
  }

  return (
    candidates.find((candidate) => candidate.kind === "added") ??
    candidates.find((candidate) => candidate.kind === "context")
  );
}

function createRangePosition({
  context,
  file,
  side,
  startCandidate,
  endCandidates,
}: {
  context: GitLabMergeRequestContext;
  file: GitLabDiffFile;
  side: ReviewFinding["side"];
  startCandidate: PositionCandidate;
  endCandidates: PositionCandidate[];
}): GitLabTextPosition | undefined {
  const endCandidate = selectBestRangeEndCandidate({
    endCandidates,
    side,
  });

  if (endCandidate === undefined) {
    return undefined;
  }

  return createPosition({
    context,
    file,
    oldLine: endCandidate.oldLine,
    newLine: endCandidate.newLine,
    lineRange: {
      start: createLineRangePoint({
        file,
        side,
        oldLine: startCandidate.oldLine,
        newLine: startCandidate.newLine,
      }),
      end: createLineRangePoint({
        file,
        side,
        oldLine: endCandidate.oldLine,
        newLine: endCandidate.newLine,
      }),
    },
  });
}

function selectBestRangeEndCandidate({
  endCandidates,
  side,
}: {
  endCandidates: PositionCandidate[];
  side: ReviewFinding["side"];
}): PositionCandidate | undefined {
  if (side === "new") {
    return endCandidates.find((candidate) => candidate.newLine !== undefined);
  }

  return endCandidates.find((candidate) => candidate.oldLine !== undefined);
}

function createPosition({
  context,
  file,
  oldLine,
  newLine,
  lineRange,
}: {
  context: GitLabMergeRequestContext;
  file: GitLabDiffFile;
  oldLine?: number | undefined;
  newLine?: number | undefined;
  lineRange?: GitLabLineRange | undefined;
}): GitLabTextPosition {
  return {
    positionType: "text",
    baseSha: context.mergeRequest.diffRefs.baseSha,
    startSha: context.mergeRequest.diffRefs.startSha,
    headSha: context.mergeRequest.diffRefs.headSha,
    oldPath: file.oldPath,
    newPath: file.newPath,
    ...(oldLine === undefined ? {} : { oldLine }),
    ...(newLine === undefined ? {} : { newLine }),
    ...(lineRange === undefined ? {} : { lineRange }),
  };
}

function createLineRangePoint({
  file,
  side,
  oldLine,
  newLine,
}: {
  file: GitLabDiffFile;
  side: "new" | "old";
  oldLine?: number | undefined;
  newLine?: number | undefined;
}): GitLabLineRangePoint {
  return {
    type: side,
    lineCode: createLineCode({
      file,
      oldLine,
      newLine,
    }),
    ...(oldLine === undefined ? {} : { oldLine }),
    ...(newLine === undefined ? {} : { newLine }),
  };
}

function createLineCode({
  file,
  oldLine,
  newLine,
}: {
  file: GitLabDiffFile;
  oldLine?: number | undefined;
  newLine?: number | undefined;
}): string {
  // GitLab multiline notes require line_code as SHA1(file path)_oldLine_newLine.
  const pathHash = createHash("sha1").update(file.newPath).digest("hex");

  return `${pathHash}_${String(oldLine ?? 0)}_${String(newLine ?? 0)}`;
}
