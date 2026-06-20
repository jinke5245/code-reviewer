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
  readStringArray,
} from "../platform/response-utils.js";

/** Sanitized issue metadata returned by the GitLab reference tools. */
export type GitLabReadableIssue = {
  projectId: string;
  iid: number;
  title: string;
  description: string;
  state: string;
  labels: string[];
  webUrl: string;
};

/** Sanitized merge request metadata returned by the GitLab reference tools. */
export type GitLabReadableMergeRequest = {
  projectId: string;
  iid: number;
  title: string;
  description: string;
  state: string;
  labels: string[];
  webUrl: string;
  sourceBranch: string;
  targetBranch: string;
};

/** Sanitized issue summary returned by GitLab reference list tools. */
export type GitLabReadableIssueSummary = Omit<
  GitLabReadableIssue,
  "description"
>;

/** Sanitized merge request summary returned by GitLab reference list tools. */
export type GitLabReadableMergeRequestSummary = Omit<
  GitLabReadableMergeRequest,
  "description"
>;

/** Supported GitLab reference target kinds. */
export type GitLabReferenceKind = "issue" | "merge_request";

/** Parsed GitLab issue or merge request reference target. */
export type GitLabReferenceTarget = {
  kind: GitLabReferenceKind;
  projectId?: string;
  iid: number;
};

/** Options for creating a client that reads GitLab referenced resources. */
export type CreateGitLabReferenceContextClientOptions = {
  apiUrl: string;
  token: string;
} & GitLabSdkClientInjection;

/** Options for listing GitLab reference summaries. */
export type ListGitLabReferencesOptions = {
  state?: string;
  search?: string;
  limit?: number;
};

/** Client for listing and reading issue and merge request context. */
export type GitLabReferenceContextClient = {
  listIssues: (
    projectId: string,
    options?: ListGitLabReferencesOptions,
  ) => Promise<GitLabReadableIssueSummary[]>;
  getIssue: (projectId: string, iid: number) => Promise<GitLabReadableIssue>;
  listMergeRequests: (
    projectId: string,
    options?: ListGitLabReferencesOptions,
  ) => Promise<GitLabReadableMergeRequestSummary[]>;
  getMergeRequest: (
    projectId: string,
    iid: number,
  ) => Promise<GitLabReadableMergeRequest>;
};

/** Parses GitLab references such as `#12`, `!34`, or `group/project!56`. */
export function parseGitLabReference(reference: string): GitLabReferenceTarget {
  const trimmed = reference.trim();
  const currentProjectMatch = /^([#!])(\d+)$/u.exec(trimmed);

  if (currentProjectMatch !== null) {
    return {
      kind: readReferenceKind(currentProjectMatch[1]),
      iid: readMatchedNumber(currentProjectMatch, 2),
    };
  }

  const crossProjectMatch = /^(.+?)([#!])(\d+)$/u.exec(trimmed);

  if (crossProjectMatch === null) {
    throw new Error(`Invalid GitLab reference: ${reference}`);
  }

  const projectId = crossProjectMatch[1];

  if (projectId === undefined) {
    throw new Error(`Invalid GitLab reference: ${reference}`);
  }

  return {
    projectId,
    kind: readReferenceKind(crossProjectMatch[2]),
    iid: readMatchedNumber(crossProjectMatch, 3),
  };
}

/** Creates a REST-backed client for reading referenced GitLab issues and MRs. */
export function createGitLabReferenceContextClient({
  apiUrl,
  token,
  ...gitlabOptions
}: CreateGitLabReferenceContextClientOptions): GitLabReferenceContextClient {
  const gitlab = resolveGitLabSdkClient({
    apiUrl,
    token,
    ...gitlabOptions,
  });

  return {
    async listIssues(projectId, options = {}) {
      const items = asArray(
        await requestGitLabReference(() =>
          gitlab.Issues.all({
            projectId,
            ...toGitLabListOptions(options),
          }),
        ),
        "GitLab reference API",
      );

      return items
        .slice(0, readListLimit(options.limit))
        .map((item) => parseIssueSummary(projectId, item));
    },

    async getIssue(projectId, iid) {
      const data = asRecord(
        await requestGitLabReference(() =>
          gitlab.Issues.show(readGitLabIid(iid, "issue IID"), { projectId }),
        ),
        "GitLab reference API",
      );

      return {
        projectId,
        iid: readNumber(data, "iid", "GitLab reference API"),
        title: readString(data, "title", "GitLab reference API"),
        description:
          readOptionalString(data, "description", "GitLab reference API") ?? "",
        state: readString(data, "state", "GitLab reference API"),
        labels: readStringArray(data, "labels", "GitLab reference API"),
        webUrl: readString(data, "web_url", "GitLab reference API"),
      };
    },

    async listMergeRequests(projectId, options = {}) {
      const items = asArray(
        await requestGitLabReference(() =>
          gitlab.MergeRequests.all({
            projectId,
            ...toGitLabListOptions(options),
          }),
        ),
        "GitLab reference API",
      );

      return items
        .slice(0, readListLimit(options.limit))
        .map((item) => parseMergeRequestSummary(projectId, item));
    },

    async getMergeRequest(projectId, iid) {
      const data = asRecord(
        await requestGitLabReference(() =>
          gitlab.MergeRequests.show(
            projectId,
            readGitLabIid(iid, "merge request IID"),
          ),
        ),
        "GitLab reference API",
      );

      return {
        projectId,
        iid: readNumber(data, "iid", "GitLab reference API"),
        title: readString(data, "title", "GitLab reference API"),
        description:
          readOptionalString(data, "description", "GitLab reference API") ?? "",
        state: readString(data, "state", "GitLab reference API"),
        labels: readStringArray(data, "labels", "GitLab reference API"),
        webUrl: readString(data, "web_url", "GitLab reference API"),
        sourceBranch: readString(data, "source_branch", "GitLab reference API"),
        targetBranch: readString(data, "target_branch", "GitLab reference API"),
      };
    },
  };
}

function parseIssueSummary(
  projectId: string,
  value: unknown,
): GitLabReadableIssueSummary {
  const data = asRecord(value, "GitLab reference API");

  return {
    projectId,
    iid: readNumber(data, "iid", "GitLab reference API"),
    title: readString(data, "title", "GitLab reference API"),
    state: readString(data, "state", "GitLab reference API"),
    labels: readStringArray(data, "labels", "GitLab reference API"),
    webUrl: readString(data, "web_url", "GitLab reference API"),
  };
}

function parseMergeRequestSummary(
  projectId: string,
  value: unknown,
): GitLabReadableMergeRequestSummary {
  const data = asRecord(value, "GitLab reference API");

  return {
    projectId,
    iid: readNumber(data, "iid", "GitLab reference API"),
    title: readString(data, "title", "GitLab reference API"),
    state: readString(data, "state", "GitLab reference API"),
    labels: readStringArray(data, "labels", "GitLab reference API"),
    webUrl: readString(data, "web_url", "GitLab reference API"),
    sourceBranch: readString(data, "source_branch", "GitLab reference API"),
    targetBranch: readString(data, "target_branch", "GitLab reference API"),
  };
}

function toGitLabListOptions({
  limit,
  search,
  state,
}: ListGitLabReferencesOptions): {
  maxPages: number;
  perPage: number;
  search?: string;
  state?: string;
} {
  const effectiveLimit = readListLimit(limit);
  const perPage = Math.min(effectiveLimit, 100);

  return {
    perPage,
    maxPages: Math.ceil(effectiveLimit / perPage),
    ...(search === undefined ? {} : { search }),
    ...(state === undefined ? {} : { state }),
  };
}

function readListLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 100;
  }

  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error(
      "Expected GitLab reference list limit to be a positive integer",
    );
  }

  return limit;
}

async function requestGitLabReference(
  request: () => Promise<unknown>,
): Promise<unknown> {
  try {
    return await request();
  } catch (error) {
    throw toGitLabSdkRequestError("GitLab reference API request failed", error);
  }
}

function readMatchedNumber(match: RegExpExecArray, index: number): number {
  const value = match[index];

  if (value === undefined) {
    throw new Error("Expected GitLab reference iid");
  }

  return readGitLabIid(value, "reference IID");
}

function readReferenceKind(marker: string | undefined): GitLabReferenceKind {
  if (marker === "#") {
    return "issue";
  }

  if (marker === "!") {
    return "merge_request";
  }

  throw new Error("Expected GitLab reference marker");
}
