import { createHash } from "node:crypto";

import {
  readGitLabIid,
  resolveGitLabSdkClient,
  toGitLabSdkRequestError,
  type GitLabSdkClientInjection,
} from "./client.js";
import type { GitLabMergeRequestContext } from "./mr-context.js";
import type {
  GitLabTextPosition,
  ReviewPublicationPlan,
} from "./review-publication-plan.js";
import { renderGitLabReviewTemplate } from "./review-template-rendering.js";
import {
  asArray,
  asRecord,
  readNumber,
  readOptionalBoolean,
  readOptionalString,
  readString,
  stableStringify,
} from "../platform/response-utils.js";
import { formatReviewFindingSeverity } from "../review/formatting.js";
import {
  publishMergeRequestSummaryNote,
  type GitLabMergeRequestNoteClient,
  type PublishMergeRequestSummaryNoteResult,
} from "./summary-note.js";
import type { ReviewFinding } from "../review/report.js";

/** A single note inside a GitLab merge request discussion. */
export type GitLabMergeRequestDiscussionNote = {
  id: number;
  body: string;
  authorUsername?: string;
  system?: boolean;
  resolvable?: boolean;
  resolved?: boolean;
  createdAt?: string;
  updatedAt?: string;
  webUrl?: string;
};

/** A GitLab merge request discussion thread. */
export type GitLabMergeRequestDiscussion = {
  id: string;
  individualNote?: boolean;
  notes: GitLabMergeRequestDiscussionNote[];
};

/** Minimal client required to list and create merge request discussions. */
export type GitLabMergeRequestDiscussionClient = {
  listMergeRequestDiscussions: (
    projectId: string,
    mergeRequestIid: string,
  ) => Promise<GitLabMergeRequestDiscussion[]>;
  createMergeRequestDiscussion: (
    projectId: string,
    mergeRequestIid: string,
    body: string,
    position?: GitLabTextPosition,
  ) => Promise<GitLabMergeRequestDiscussion>;
};

/** Options for creating a REST-backed merge request discussion client. */
export type CreateGitLabMergeRequestDiscussionClientOptions = {
  apiUrl: string;
  token: string;
} & GitLabSdkClientInjection;

/** Inputs required to publish inline discussions for a review report. */
export type PublishMergeRequestInlineDiscussionsOptions = {
  context: GitLabMergeRequestContext;
  discussionClient: GitLabMergeRequestDiscussionClient;
  inlineTemplate?: string;
  plan: ReviewPublicationPlan;
  summaryClient: GitLabMergeRequestNoteClient;
  summaryTemplate?: string;
};

/** Counts produced while publishing inline discussions. */
export type PublishMergeRequestInlineDiscussionsResult = {
  mode: "inline";
  created: number;
  skipped: number;
  unpublished: number;
  summary?: PublishMergeRequestSummaryNoteResult;
};

/** Options for fingerprinting an inline discussion. */
export type CreateInlineDiscussionFingerprintOptions = {
  finding: ReviewFinding;
  position: GitLabTextPosition;
};

/** Options for rendering an inline discussion body. */
export type CreateInlineDiscussionBodyOptions =
  CreateInlineDiscussionFingerprintOptions & {
    template?: string;
  };

/** Creates a stable fingerprint for an inline finding at a diff position. */
export function createInlineDiscussionFingerprint({
  finding,
  position,
}: CreateInlineDiscussionFingerprintOptions): string {
  return createHash("sha256")
    .update(
      stableStringify({
        finding: toInlineFindingFingerprintInput(finding),
        position: toInlinePositionFingerprintInput(position),
      }),
    )
    .digest("hex");
}

/** Renders the Markdown body used for an inline discussion note. */
export function createInlineDiscussionBody({
  finding,
  position,
  template,
}: CreateInlineDiscussionBodyOptions): string {
  const fingerprint = createInlineDiscussionFingerprint({ finding, position });
  const fingerprintMarker = `<!-- codereviewer:inline:${fingerprint} -->`;

  if (template !== undefined) {
    return renderInlineDiscussionTemplate({
      finding,
      fingerprintMarker,
      template,
    });
  }

  const fixSection = renderInlineFixSection(finding);
  const sections = [
    renderInlineDiscussionSection("Issue", finding.title),
    renderInlineDiscussionSection(
      "Impact",
      formatReviewFindingSeverity(finding.severity),
    ),
    renderInlineDiscussionSection("Why it matters", finding.body),
    fixSection === undefined
      ? undefined
      : renderInlineDiscussionSection("How to fix", fixSection),
    fingerprintMarker,
  ];

  return sections.filter((section) => section !== undefined).join("\n\n");
}

function renderInlineDiscussionTemplate({
  finding,
  fingerprintMarker,
  template,
}: {
  finding: ReviewFinding;
  fingerprintMarker: string;
  template: string;
}): string {
  const context = createInlineDiscussionTemplateContext({
    finding,
    fingerprintMarker,
  });
  return renderGitLabReviewTemplate({
    fingerprintMarker,
    template,
    values: context.values,
  });
}

function createInlineDiscussionTemplateContext({
  finding,
  fingerprintMarker,
}: {
  finding: ReviewFinding;
  fingerprintMarker: string;
}): {
  values: {
    comment: Record<string, string | number>;
    finding: Record<string, string | number>;
  };
} {
  const values = {
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
      location: formatInlineDiscussionLocation(finding),
      severityLabel: formatReviewFindingSeverity(finding.severity),
      suggestionBlock:
        renderGitLabSuggestionBlock(finding.replacementCode) ?? "",
      fingerprint: fingerprintMarker,
    },
  };

  return {
    values,
  };
}

function renderInlineFixSection(finding: ReviewFinding): string | undefined {
  const parts = [
    finding.suggestion.trim().length === 0 ? undefined : finding.suggestion,
    renderGitLabSuggestionBlock(finding.replacementCode),
  ].filter((part) => part !== undefined);

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join("\n\n");
}

function renderGitLabSuggestionBlock(
  replacementCode: string,
): string | undefined {
  if (replacementCode.trim().length === 0) {
    return undefined;
  }

  if (replacementCode.includes("```")) {
    return undefined;
  }

  return ["```suggestion:-0+0", replacementCode.trimEnd(), "```"].join("\n");
}

function renderInlineDiscussionSection(title: string, body: string): string {
  return `**${title}:**\n\n${body}`;
}

function formatInlineDiscussionLocation(finding: ReviewFinding): string {
  const range =
    finding.startLine === finding.endLine
      ? String(finding.startLine)
      : `${String(finding.startLine)}-${String(finding.endLine)}`;

  return `${finding.path}:${range} (${finding.side})`;
}

/** Publishes inline discussions and records unmapped findings as unpublished. */
export async function publishMergeRequestInlineDiscussions({
  context,
  discussionClient,
  inlineTemplate,
  plan,
  summaryClient,
  summaryTemplate,
}: PublishMergeRequestInlineDiscussionsOptions): Promise<PublishMergeRequestInlineDiscussionsResult> {
  const projectId = context.gitlab.projectId;
  const mergeRequestIid = context.gitlab.mergeRequestIid;
  const summary = await publishMergeRequestSummaryNote({
    client: summaryClient,
    projectId,
    mergeRequestIid,
    plan,
    ...(summaryTemplate === undefined ? {} : { summaryTemplate }),
  });
  const existingDiscussions =
    await discussionClient.listMergeRequestDiscussions(
      projectId,
      mergeRequestIid,
    );
  const existingInlineFingerprints =
    collectExistingDiscussionFingerprints(existingDiscussions);
  let created = 0;
  let failed = 0;
  let skipped = 0;

  for (const { finding, position } of plan.inlineFindings) {
    const fingerprint = createInlineDiscussionFingerprint({
      finding,
      position,
    });

    if (existingInlineFingerprints.has(fingerprint)) {
      skipped += 1;
      continue;
    }

    try {
      await discussionClient.createMergeRequestDiscussion(
        projectId,
        mergeRequestIid,
        createInlineDiscussionBody({
          finding,
          position,
          ...(inlineTemplate === undefined ? {} : { template: inlineTemplate }),
        }),
        position,
      );
    } catch {
      failed += 1;
      continue;
    }
    existingInlineFingerprints.add(fingerprint);
    created += 1;
  }

  return {
    mode: "inline",
    created,
    skipped,
    unpublished: plan.unmappedFindings.length + failed,
    summary,
  };
}

/** Creates a REST-backed GitLab merge request discussion client. */
export function createGitLabMergeRequestDiscussionClient({
  apiUrl,
  token,
  ...gitlabOptions
}: CreateGitLabMergeRequestDiscussionClientOptions): GitLabMergeRequestDiscussionClient {
  const gitlab = resolveGitLabSdkClient({
    apiUrl,
    token,
    ...gitlabOptions,
  });

  return {
    async listMergeRequestDiscussions(projectId, mergeRequestIid) {
      const items = asArray(
        await requestGitLabDiscussions(() =>
          gitlab.MergeRequestDiscussions.all(
            projectId,
            readGitLabIid(mergeRequestIid, "merge request IID"),
            { perPage: 100 },
          ),
        ),
        "GitLab discussions API",
      );

      return items.map(parseGitLabDiscussion);
    },

    async createMergeRequestDiscussion(
      projectId,
      mergeRequestIid,
      body,
      position,
    ) {
      return parseGitLabDiscussion(
        await requestGitLabDiscussions(() =>
          gitlab.MergeRequestDiscussions.create(
            projectId,
            readGitLabIid(mergeRequestIid, "merge request IID"),
            body,
            position === undefined
              ? undefined
              : {
                  position,
                },
          ),
        ),
      );
    },
  };
}

function collectExistingDiscussionFingerprints(
  discussions: GitLabMergeRequestDiscussion[],
): Set<string> {
  const fingerprints = new Set<string>();
  const marker = new RegExp(
    "<!-- codereviewer:inline:([a-f0-9]{64}) -->",
    "gu",
  );

  for (const discussion of discussions) {
    for (const note of discussion.notes) {
      for (const match of note.body.matchAll(marker)) {
        const fingerprint = match[1];

        if (fingerprint !== undefined) {
          fingerprints.add(fingerprint);
        }
      }
    }
  }

  return fingerprints;
}

async function requestGitLabDiscussions(
  request: () => Promise<unknown>,
): Promise<unknown> {
  try {
    return await request();
  } catch (error) {
    throw toGitLabSdkRequestError(
      "GitLab discussions API request failed",
      error,
    );
  }
}

function parseGitLabDiscussion(value: unknown): GitLabMergeRequestDiscussion {
  const data = asRecord(value, "GitLab discussions API");
  const notes = asArray(data.notes, "GitLab discussions API").map(
    parseGitLabDiscussionNote,
  );
  const individualNote = readOptionalBoolean(
    data,
    "individual_note",
    "GitLab discussions API",
  );

  return {
    id: readString(data, "id", "GitLab discussions API"),
    ...(individualNote === undefined ? {} : { individualNote }),
    notes,
  };
}

function parseGitLabDiscussionNote(
  value: unknown,
): GitLabMergeRequestDiscussionNote {
  const data = asRecord(value, "GitLab discussions API");
  const authorUsername = readOptionalAuthorUsername(data);
  const system = readOptionalBoolean(data, "system", "GitLab discussions API");
  const resolvable = readOptionalBoolean(
    data,
    "resolvable",
    "GitLab discussions API",
  );
  const resolved = readOptionalBoolean(
    data,
    "resolved",
    "GitLab discussions API",
  );
  const createdAt = readOptionalString(
    data,
    "created_at",
    "GitLab discussions API",
  );
  const updatedAt = readOptionalString(
    data,
    "updated_at",
    "GitLab discussions API",
  );
  const webUrl = readOptionalString(data, "web_url", "GitLab discussions API");

  return {
    id: readNumber(data, "id", "GitLab discussions API"),
    body: readString(data, "body", "GitLab discussions API"),
    ...(authorUsername === undefined ? {} : { authorUsername }),
    ...(system === undefined ? {} : { system }),
    ...(resolvable === undefined ? {} : { resolvable }),
    ...(resolved === undefined ? {} : { resolved }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(webUrl === undefined ? {} : { webUrl }),
  };
}

function readOptionalAuthorUsername(
  data: Record<string, unknown>,
): string | undefined {
  const value = data.author;

  if (value === undefined || value === null) {
    return undefined;
  }

  const author = asRecord(value, "GitLab discussions API");

  return readOptionalString(author, "username", "GitLab discussions API");
}

function toInlineFindingFingerprintInput(
  finding: ReviewFinding,
): Pick<
  ReviewFinding,
  "code" | "endLine" | "path" | "severity" | "side" | "startLine"
> {
  return {
    code: finding.code,
    endLine: finding.endLine,
    path: finding.path,
    severity: finding.severity,
    side: finding.side,
    startLine: finding.startLine,
  };
}

function toInlinePositionFingerprintInput(
  position: GitLabTextPosition,
): Pick<
  GitLabTextPosition,
  "lineRange" | "newLine" | "newPath" | "oldLine" | "oldPath" | "positionType"
> {
  return {
    positionType: position.positionType,
    oldPath: position.oldPath,
    newPath: position.newPath,
    ...(position.oldLine === undefined ? {} : { oldLine: position.oldLine }),
    ...(position.newLine === undefined ? {} : { newLine: position.newLine }),
    ...(position.lineRange === undefined
      ? {}
      : { lineRange: position.lineRange }),
  };
}
