import { createHash } from "node:crypto";

import type {
  GitHubInlineFinding,
  GitHubReviewPublicationPlan,
} from "./review-publication-plan.js";
import { stableStringify } from "../platform/response-utils.js";
import type { ReviewPublishMode } from "../platform/types.js";
import { formatReviewFindingSeverity } from "../review/formatting.js";
import type { ReviewFinding } from "../review/report.js";
import { renderReviewTemplate } from "../review/template-rendering.js";

export type CreateGitHubSummaryCommentBodyOptions = {
  template?: string;
};

export type CreateGitHubInlineCommentBodyOptions = {
  template?: string;
};

/** Creates a stable fingerprint for a GitHub summary comment. */
export function createGitHubSummaryCommentFingerprint(
  plan: GitHubReviewPublicationPlan,
): string {
  return createHash("sha256")
    .update(
      stableStringify({
        overview: plan.overview,
        findings: plan.findings
          .map(toFindingFingerprintInput)
          .sort(compareFindingFingerprintInputs),
      }),
    )
    .digest("hex");
}

/** Renders the Markdown body used for a GitHub PR summary comment. */
export function createGitHubSummaryCommentBody(
  plan: GitHubReviewPublicationPlan,
  options: CreateGitHubSummaryCommentBodyOptions = {},
): string {
  const fingerprint = createGitHubSummaryCommentFingerprint(plan);
  const fingerprintMarker = `<!-- codereviewer:summary:${fingerprint} -->`;

  if (options.template !== undefined) {
    return renderGitHubSummaryTemplate({
      fingerprintMarker,
      plan,
      template: options.template,
    });
  }

  const sections = [
    "## Code Reviewer",
    renderReviewOverview(plan),
    plan.summary,
    renderFindingsSection(plan.findings),
    renderMetadata(plan),
    fingerprintMarker,
  ];

  return sections.filter((section) => section.trim() !== "").join("\n\n");
}

/** Creates a stable fingerprint for a GitHub inline review comment. */
export function createGitHubInlineCommentFingerprint({
  finding,
  position,
}: GitHubInlineFinding): string {
  return createHash("sha256")
    .update(
      stableStringify({
        finding: toFindingFingerprintInput(finding),
        position,
      }),
    )
    .digest("hex");
}

/** Renders the Markdown body used for a GitHub inline review comment. */
export function createGitHubInlineCommentBody(
  inlineFinding: GitHubInlineFinding,
  options: CreateGitHubInlineCommentBodyOptions = {},
): string {
  const fingerprint = createGitHubInlineCommentFingerprint(inlineFinding);
  const fingerprintMarker = `<!-- codereviewer:inline:${fingerprint} -->`;
  const finding = inlineFinding.finding;

  if (options.template !== undefined) {
    return renderGitHubInlineTemplate({
      finding,
      fingerprintMarker,
      template: options.template,
    });
  }

  const fixSection = renderInlineFixSection(finding);
  const sections = [
    renderInlineSection("Issue", finding.title),
    renderInlineSection(
      "Impact",
      formatReviewFindingSeverity(finding.severity),
    ),
    renderInlineSection("Why it matters", finding.body),
    fixSection === undefined
      ? undefined
      : renderInlineSection("How to fix", fixSection),
    fingerprintMarker,
  ];

  return sections.filter((section) => section !== undefined).join("\n\n");
}

function renderGitHubSummaryTemplate({
  fingerprintMarker,
  plan,
  template,
}: {
  fingerprintMarker: string;
  plan: GitHubReviewPublicationPlan;
  template: string;
}): string {
  return renderReviewTemplate({
    fingerprintMarker,
    template,
    values: createGitHubSummaryTemplateContext({ fingerprintMarker, plan }),
  });
}

function createGitHubSummaryTemplateContext({
  fingerprintMarker,
  plan,
}: {
  fingerprintMarker: string;
  plan: GitHubReviewPublicationPlan;
}): {
  comment: Record<string, string>;
  review: {
    summary: string;
    overview: GitHubReviewPublicationPlan["overview"] & {
      publishModeLabel: string;
    };
    findings: Array<
      ReviewFinding & {
        index: number;
        location: string;
        number: number;
        severityLabel: string;
      }
    >;
    metadata: {
      promptBytes: number;
      toolCalls: number;
    };
  };
} {
  return {
    review: {
      summary: plan.summary,
      overview: {
        ...plan.overview,
        publishModeLabel: formatPublishMode(plan.overview.publishMode),
      },
      findings: plan.findings.map((finding, index) => ({
        ...finding,
        index,
        location: formatFindingLocation(finding),
        number: index + 1,
        severityLabel: formatReviewFindingSeverity(finding.severity),
      })),
      metadata: {
        promptBytes: plan.promptSummary?.totalBytes ?? 0,
        toolCalls: plan.toolCalls.length,
      },
    },
    comment: {
      fingerprint: fingerprintMarker,
    },
  };
}

function renderGitHubInlineTemplate({
  finding,
  fingerprintMarker,
  template,
}: {
  finding: ReviewFinding;
  fingerprintMarker: string;
  template: string;
}): string {
  return renderReviewTemplate({
    fingerprintMarker,
    template,
    values: createGitHubInlineTemplateContext({
      finding,
      fingerprintMarker,
    }),
  });
}

function createGitHubInlineTemplateContext({
  finding,
  fingerprintMarker,
}: {
  finding: ReviewFinding;
  fingerprintMarker: string;
}): {
  comment: Record<string, string>;
  finding: Record<string, string | number>;
} {
  return {
    finding: {
      severity: finding.severity,
      title: finding.title,
      body: finding.body,
      suggestion: finding.suggestion,
      path: finding.path,
      side: finding.side,
      startLine: finding.startLine,
      endLine: finding.endLine,
      code: finding.code,
      replacementCode: finding.replacementCode,
    },
    comment: {
      location: formatFindingLocation(finding),
      severityLabel: formatReviewFindingSeverity(finding.severity),
      suggestionBlock:
        renderGitHubSuggestionBlock(finding.replacementCode) ?? "",
      fingerprint: fingerprintMarker,
    },
  };
}

function renderReviewOverview(plan: GitHubReviewPublicationPlan): string {
  return [
    "### Review overview",
    `- Reviewed commit: \`${plan.overview.commit}\``,
    `- Changed files: ${String(plan.overview.changedFiles)}`,
    `- Findings: ${String(plan.overview.findings)}`,
    `- Highest severity: ${plan.overview.highestSeverity}`,
    `- Inline findings: ${String(plan.overview.inlineFindings)}`,
    `- Unmapped findings: ${String(plan.overview.unmappedFindings)}`,
    `- Publish mode: ${plan.overview.publishMode}`,
  ].join("\n");
}

function renderFindingsSection(findings: ReviewFinding[]): string {
  if (findings.length === 0) {
    return "### Findings\n\nNo findings.";
  }

  return [
    "### Findings",
    findings
      .map((finding, index) =>
        [
          `${String(index + 1)}. **[${finding.severity}] ${finding.title}**`,
          `   - Location: \`${formatFindingLocation(finding)}\``,
        ].join("\n"),
      )
      .join("\n\n"),
  ].join("\n\n");
}

function renderMetadata(plan: GitHubReviewPublicationPlan): string {
  return [
    "### Metadata",
    `- Tool calls: ${String(plan.toolCalls.length)}`,
    `- Prompt bytes: ${String(plan.promptSummary?.totalBytes ?? 0)}`,
  ].join("\n");
}

function renderInlineFixSection(finding: ReviewFinding): string | undefined {
  const parts = [
    finding.suggestion.trim().length === 0 ? undefined : finding.suggestion,
    renderGitHubSuggestionBlock(finding.replacementCode),
  ].filter((part) => part !== undefined);

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join("\n\n");
}

function renderGitHubSuggestionBlock(
  replacementCode: string,
): string | undefined {
  if (replacementCode.trim().length === 0 || replacementCode.includes("```")) {
    return undefined;
  }

  return ["```suggestion", replacementCode.trimEnd(), "```"].join("\n");
}

function renderInlineSection(title: string, body: string): string {
  return `**${title}:**\n\n${body}`;
}

function formatPublishMode(publishMode: ReviewPublishMode): string {
  const labels: Record<ReviewPublishMode, string> = {
    "dry-run": "dry-run (no GitHub comments)",
    summary: "summary issue comment only",
    inline: "inline (summary issue comment plus inline review comments)",
  };

  return labels[publishMode];
}

function formatFindingLocation(finding: ReviewFinding): string {
  const range =
    finding.startLine === finding.endLine
      ? String(finding.startLine)
      : `${String(finding.startLine)}-${String(finding.endLine)}`;

  return `${finding.path}:${range} (${finding.side})`;
}

type FindingFingerprintInput = Pick<
  ReviewFinding,
  "code" | "endLine" | "path" | "severity" | "side" | "startLine"
>;

function toFindingFingerprintInput(
  finding: ReviewFinding,
): FindingFingerprintInput {
  return {
    code: finding.code,
    endLine: finding.endLine,
    path: finding.path,
    severity: finding.severity,
    side: finding.side,
    startLine: finding.startLine,
  };
}

function compareFindingFingerprintInputs(
  left: FindingFingerprintInput,
  right: FindingFingerprintInput,
): number {
  return (
    left.path.localeCompare(right.path) ||
    left.side.localeCompare(right.side) ||
    left.startLine - right.startLine ||
    left.endLine - right.endLine ||
    left.code.localeCompare(right.code) ||
    left.severity.localeCompare(right.severity)
  );
}
