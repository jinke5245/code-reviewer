import { parseUnifiedDiffLines } from "../platform/diff-lines.js";
import type {
  ChangedFileDiff,
  ReviewPublishMode,
  ReviewTargetContext,
} from "../platform/types.js";
import type {
  ReviewFinding,
  ReviewFindingSeverity,
  ReviewReport,
} from "../review/report.js";

export type GitHubReviewCommentSide = "LEFT" | "RIGHT";

export type GitHubReviewCommentPosition = {
  commitId: string;
  path: string;
  side: GitHubReviewCommentSide;
  line: number;
  startLine?: number;
  startSide?: GitHubReviewCommentSide;
};

export type GitHubInlineFinding = {
  finding: ReviewFinding;
  position: GitHubReviewCommentPosition;
};

export type GitHubReviewRunOverview = {
  provider: "github";
  changedFiles: number;
  commit: string;
  findings: number;
  highestSeverity: ReviewFindingSeverity | "none";
  inlineFindings: number;
  publishMode: ReviewPublishMode;
  unmappedFindings: number;
};

export type GitHubReviewPublicationPlan = {
  overview: GitHubReviewRunOverview;
  summary: string;
  findings: ReviewFinding[];
  inlineFindings: GitHubInlineFinding[];
  unmappedFindings: ReviewFinding[];
  promptSummary?: ReviewReport["promptSummary"];
  toolCalls: ReviewReport["toolCalls"];
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

/** Derives the GitHub publishing shape from canonical review findings. */
export function createGitHubReviewPublicationPlan({
  context,
  publishMode,
  report,
}: {
  context: ReviewTargetContext;
  publishMode: ReviewPublishMode;
  report: ReviewReport;
}): GitHubReviewPublicationPlan {
  const inlineFindings: GitHubInlineFinding[] = [];
  const unmappedFindings: ReviewFinding[] = [];

  for (const finding of report.findings) {
    const position = mapFindingToGitHubPosition({ context, finding });

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
      provider: "github",
      commit: context.pullRequest.headSha,
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

export function mapFindingToGitHubPosition({
  context,
  finding,
}: {
  context: ReviewTargetContext;
  finding: ReviewFinding;
}): GitHubReviewCommentPosition | undefined {
  const changedFile = context.changedFiles.find(
    (file) => file.newPath === finding.path || file.oldPath === finding.path,
  );

  if (changedFile === undefined) {
    return undefined;
  }

  const startCandidate = selectBestSingleLineCandidate(
    collectPositionCandidates({
      file: changedFile,
      line: finding.startLine,
      side: finding.side,
    }),
    finding.side,
  );

  if (startCandidate === undefined) {
    return undefined;
  }

  const endCandidate = selectBestSingleLineCandidate(
    collectPositionCandidates({
      file: changedFile,
      line: finding.endLine,
      side: finding.side,
    }),
    finding.side,
  );

  if (endCandidate === undefined) {
    return undefined;
  }

  const githubSide = finding.side === "new" ? "RIGHT" : "LEFT";
  const startLine =
    finding.side === "new" ? startCandidate.newLine : startCandidate.oldLine;
  const endLine =
    finding.side === "new" ? endCandidate.newLine : endCandidate.oldLine;

  if (startLine === undefined) {
    return undefined;
  }

  if (endLine === undefined) {
    return undefined;
  }

  return finding.startLine === finding.endLine
    ? {
        commitId: context.pullRequest.headSha,
        path: changedFile.newPath,
        side: githubSide,
        line: endLine,
      }
    : {
        commitId: context.pullRequest.headSha,
        path: changedFile.newPath,
        side: githubSide,
        startLine,
        startSide: githubSide,
        line: endLine,
      };
}

function collectPositionCandidates({
  file,
  line,
  side,
}: {
  file: ChangedFileDiff;
  line: number;
  side: ReviewFinding["side"];
}): PositionCandidate[] {
  const candidates: PositionCandidate[] = [];
  for (const diffLine of parseUnifiedDiffLines(file.diff)) {
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
