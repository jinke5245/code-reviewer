import { createHash } from "node:crypto";

import type {
  ReviewPublicationPlan,
  ReviewPublishMode,
} from "./review-publication-plan.js";
import { formatReviewFindingSeverity } from "./review-formatting.js";
import { renderGitLabReviewTemplate } from "./review-template-rendering.js";
import type { ReviewFinding } from "../review/report.js";
import {
  readGitLabIid,
  resolveGitLabSdkClient,
  toGitLabSdkRequestError,
  type GitLabSdkClientInjection,
} from "./client.js";
import {
  asArray,
  asRecord,
  readNumber,
  readOptionalString,
  readString,
  stableStringify,
} from "./response-utils.js";

/** A merge request note returned by the GitLab notes API. */
export type GitLabMergeRequestNote = {
  id: number;
  body: string;
  webUrl?: string;
};

/** Minimal client required to list and create merge request notes. */
export type GitLabMergeRequestNoteClient = {
  listMergeRequestNotes: (
    projectId: string,
    mergeRequestIid: string,
  ) => Promise<GitLabMergeRequestNote[]>;
  createMergeRequestNote: (
    projectId: string,
    mergeRequestIid: string,
    body: string,
  ) => Promise<GitLabMergeRequestNote>;
};

/** Options for creating a REST-backed merge request note client. */
export type CreateGitLabMergeRequestNoteClientOptions = {
  apiUrl: string;
  token: string;
} & GitLabSdkClientInjection;

/** Inputs required to publish or de-duplicate a summary review note. */
export type PublishMergeRequestSummaryNoteOptions = {
  client: GitLabMergeRequestNoteClient;
  projectId: string;
  mergeRequestIid: string;
  plan: ReviewPublicationPlan;
  summaryTemplate?: string;
};

/** Result of creating or skipping a summary review note. */
export type PublishMergeRequestSummaryNoteResult =
  | {
      status: "created";
      fingerprint: string;
      noteId: number;
      noteUrl?: string;
    }
  | {
      status: "skipped";
      fingerprint: string;
      existingNoteId: number;
      existingNoteUrl?: string;
    };

/** Creates a stable fingerprint for a summary review report. */
export function createSummaryNoteFingerprint(
  plan: ReviewPublicationPlan,
): string {
  return createHash("sha256")
    .update(stableStringify(toSummaryFingerprintInput(plan)))
    .digest("hex");
}

/** Renders the Markdown body used for a merge request summary note. */
export function createSummaryNoteBody(
  plan: ReviewPublicationPlan,
  options: {
    template?: string;
  } = {},
): string {
  const fingerprint = createSummaryNoteFingerprint(plan);
  const fingerprintMarker = `<!-- codereviewer:summary:${fingerprint} -->`;

  if (options.template !== undefined) {
    return renderSummaryNoteTemplate({
      fingerprintMarker,
      plan,
      template: options.template,
    });
  }

  const sections = [
    "## Code Reviewer",
    renderReviewOverview(plan),
    plan.summary,
    renderFindingsSection("Findings", plan.findings),
    renderMetadata(plan),
    fingerprintMarker,
  ];

  return sections.filter((section) => section.trim() !== "").join("\n\n");
}

/** Publishes a summary note unless an identical fingerprint already exists. */
export async function publishMergeRequestSummaryNote({
  client,
  projectId,
  mergeRequestIid,
  plan,
  summaryTemplate,
}: PublishMergeRequestSummaryNoteOptions): Promise<PublishMergeRequestSummaryNoteResult> {
  const fingerprint = createSummaryNoteFingerprint(plan);
  const fingerprintMarker = `<!-- codereviewer:summary:${fingerprint} -->`;
  const existingNotes = await client.listMergeRequestNotes(
    projectId,
    mergeRequestIid,
  );
  const existingNote = existingNotes.find((note) =>
    note.body.includes(fingerprintMarker),
  );

  if (existingNote !== undefined) {
    return {
      status: "skipped",
      fingerprint,
      existingNoteId: existingNote.id,
      ...(existingNote.webUrl === undefined
        ? {}
        : { existingNoteUrl: existingNote.webUrl }),
    };
  }

  const note = await client.createMergeRequestNote(
    projectId,
    mergeRequestIid,
    createSummaryNoteBody(
      plan,
      summaryTemplate === undefined ? {} : { template: summaryTemplate },
    ),
  );

  return {
    status: "created",
    fingerprint,
    noteId: note.id,
    ...(note.webUrl === undefined ? {} : { noteUrl: note.webUrl }),
  };
}

function renderSummaryNoteTemplate({
  fingerprintMarker,
  plan,
  template,
}: {
  fingerprintMarker: string;
  plan: ReviewPublicationPlan;
  template: string;
}): string {
  return renderGitLabReviewTemplate({
    fingerprintMarker,
    template,
    values: createSummaryNoteTemplateContext({ fingerprintMarker, plan }),
  });
}

function createSummaryNoteTemplateContext({
  fingerprintMarker,
  plan,
}: {
  fingerprintMarker: string;
  plan: ReviewPublicationPlan;
}): {
  comment: Record<string, string>;
  review: {
    summary: string;
    overview: ReviewPublicationPlan["overview"] & {
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

/** Creates a REST-backed GitLab merge request note client. */
export function createGitLabMergeRequestNoteClient({
  apiUrl,
  token,
  ...gitlabOptions
}: CreateGitLabMergeRequestNoteClientOptions): GitLabMergeRequestNoteClient {
  const gitlab = resolveGitLabSdkClient({
    apiUrl,
    token,
    ...gitlabOptions,
  });

  return {
    async listMergeRequestNotes(projectId, mergeRequestIid) {
      const items = asArray(
        await requestGitLabNotes(() =>
          gitlab.MergeRequestNotes.all(
            projectId,
            readGitLabIid(mergeRequestIid, "merge request IID"),
            { perPage: 100 },
          ),
        ),
        "GitLab notes API",
      );

      return items.map(parseGitLabNote);
    },

    async createMergeRequestNote(projectId, mergeRequestIid, body) {
      return parseGitLabNote(
        await requestGitLabNotes(() =>
          gitlab.MergeRequestNotes.create(
            projectId,
            readGitLabIid(mergeRequestIid, "merge request IID"),
            body,
          ),
        ),
      );
    },
  };
}

function renderFindingsSection(
  title: string,
  findings: ReviewFinding[],
): string {
  if (findings.length === 0) {
    return `### ${title}\n\nNo findings.`;
  }

  return [
    `### ${title}`,
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

function formatFindingLocation(finding: ReviewFinding): string {
  const range =
    finding.startLine === finding.endLine
      ? String(finding.startLine)
      : `${String(finding.startLine)}-${String(finding.endLine)}`;

  return `${finding.path}:${range} (${finding.side})`;
}

function renderReviewOverview(plan: ReviewPublicationPlan): string {
  return [
    "### Review overview",
    `- Reviewed commit: \`${plan.overview.commit}\``,
    `- Changed files: ${String(plan.overview.changedFiles)}`,
    `- Findings: ${String(plan.overview.findings)}`,
    `- Highest severity: ${plan.overview.highestSeverity}`,
    `- Inline findings: ${String(plan.overview.inlineFindings)}`,
    `- Unmapped findings: ${String(plan.overview.unmappedFindings)}`,
    `- Publish mode: ${formatPublishMode(plan.overview.publishMode)}`,
  ].join("\n");
}

function formatPublishMode(mode: ReviewPublishMode): string {
  if (mode === "dry-run") {
    return "dry-run (no GitLab comments published)";
  }

  if (mode === "summary") {
    return "summary (findings summarized in this note)";
  }

  return "inline (summary note plus inline discussions)";
}

function renderMetadata(plan: ReviewPublicationPlan): string {
  return [
    "### Metadata",
    `- Tool calls: ${String(plan.toolCalls.length)}`,
    `- Prompt bytes: ${String(plan.promptSummary?.totalBytes ?? 0)}`,
  ].join("\n");
}

function toSummaryFingerprintInput(plan: ReviewPublicationPlan): {
  overview: SummaryOverviewFingerprintInput;
  findings: SummaryFindingFingerprintInput[];
} {
  return {
    overview: plan.overview,
    findings: plan.findings
      .map(toSummaryFindingFingerprintInput)
      .sort(compareSummaryFindingFingerprintInputs),
  };
}

type SummaryOverviewFingerprintInput = ReviewPublicationPlan["overview"];

type SummaryFindingFingerprintInput = Pick<
  ReviewFinding,
  "code" | "endLine" | "path" | "severity" | "side" | "startLine"
>;

function toSummaryFindingFingerprintInput(
  finding: ReviewFinding,
): SummaryFindingFingerprintInput {
  return {
    code: finding.code,
    endLine: finding.endLine,
    path: finding.path,
    severity: finding.severity,
    side: finding.side,
    startLine: finding.startLine,
  };
}

function compareSummaryFindingFingerprintInputs(
  left: SummaryFindingFingerprintInput,
  right: SummaryFindingFingerprintInput,
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

async function requestGitLabNotes(
  request: () => Promise<unknown>,
): Promise<unknown> {
  try {
    return await request();
  } catch (error) {
    throw toGitLabSdkRequestError("GitLab notes API request failed", error);
  }
}

function parseGitLabNote(value: unknown): GitLabMergeRequestNote {
  const data = asRecord(value, "GitLab notes API");
  const webUrl = readOptionalString(data, "web_url", "GitLab notes API");

  return {
    id: readNumber(data, "id", "GitLab notes API"),
    body: readString(data, "body", "GitLab notes API"),
    ...(webUrl === undefined ? {} : { webUrl }),
  };
}
