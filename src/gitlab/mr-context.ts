import {
  readGitLabIid,
  resolveGitLabSdkClient,
  toGitLabSdkRequestError,
  type GitLabSdkClientInjection,
} from "./client.js";
import { readRequiredEnvironmentValue } from "../env.js";
import {
  asArray,
  asRecord,
  readBoolean,
  readOptionalString,
  readString,
} from "../platform/response-utils.js";
import {
  formatGitLabTokenEnvCandidates,
  readOptionalGitLabToken,
} from "./token-env.js";
import type {
  ChangedFileDiff,
  ReviewTargetContext,
} from "../platform/types.js";

/** GitLab CI environment values required to review a merge request. */
export type GitLabMergeRequestEnvironment = {
  apiUrl: string;
  projectId: string;
  mergeRequestIid: string;
  token: string;
  tokenEnv: string;
};

/** Sanitized metadata for the merge request being reviewed. */
export type GitLabMergeRequestSummary = {
  title: string;
  description: string;
  diffRefs: GitLabDiffRefs;
};

/** GitLab diff refs required when creating inline discussions. */
export type GitLabDiffRefs = {
  baseSha: string;
  startSha: string;
  headSha: string;
};

/** A changed file diff from a GitLab merge request. */
export type GitLabDiffFile = ChangedFileDiff;

/** Minimal GitLab API client used to collect merge request review context. */
export type GitLabMergeRequestClient = {
  getMergeRequest: (
    projectId: string,
    mergeRequestIid: string,
  ) => Promise<GitLabMergeRequestSummary>;
  listMergeRequestDiffs: (
    projectId: string,
    mergeRequestIid: string,
  ) => Promise<GitLabDiffFile[]>;
};

/** Complete merge request context passed to prompts, tools, and publishers. */
export type GitLabMergeRequestContext = ReviewTargetContext & {
  provider: "gitlab";
  source: "gitlab-merge-request";
  gitlab: {
    apiUrl: string;
    projectId: string;
    mergeRequestIid: string;
  };
  mergeRequest: GitLabMergeRequestSummary;
  changedFiles: GitLabDiffFile[];
  platform: ReviewTargetContext["platform"] & {
    gitlab: NonNullable<ReviewTargetContext["platform"]["gitlab"]>;
  };
};

/** Environment-variable map used when reading GitLab CI values. */
export type GitLabMergeRequestEnvironmentVariables = Record<
  string,
  string | undefined
>;

/** Options for reading merge request environment variables. */
export type ReadGitLabMergeRequestEnvironmentOptions = {
  tokenEnv: string;
  env?: GitLabMergeRequestEnvironmentVariables;
};

/** Options for collecting merge request context. */
export type CollectGitLabMergeRequestContextOptions =
  ReadGitLabMergeRequestEnvironmentOptions & {
    client?: GitLabMergeRequestClient;
  };

/** Options for creating a REST-backed merge request client. */
export type CreateGitLabMergeRequestClientOptions = {
  apiUrl: string;
  token: string;
} & GitLabSdkClientInjection;

/** Reads and validates merge request environment variables from GitLab CI. */
export function readGitLabMergeRequestEnvironment({
  tokenEnv,
  env = process.env,
}: ReadGitLabMergeRequestEnvironmentOptions): GitLabMergeRequestEnvironment {
  const token = readOptionalGitLabToken(env, tokenEnv);
  const missing = [
    ["CI_API_V4_URL", env.CI_API_V4_URL],
    ["CI_PROJECT_ID", env.CI_PROJECT_ID],
    ["CI_MERGE_REQUEST_IID", env.CI_MERGE_REQUEST_IID],
  ]
    .filter(([, value]) => value === undefined || value.trim().length === 0)
    .map(([name]) => name);

  if (token === undefined) {
    throw new Error(
      `Missing GitLab merge request environment variables: ${[
        ...missing,
        formatGitLabTokenEnvCandidates(tokenEnv),
      ].join(", ")}`,
    );
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing GitLab merge request environment variables: ${missing.join(", ")}`,
    );
  }

  return {
    apiUrl: readRequiredEnvironmentValue(
      env,
      "CI_API_V4_URL",
      "GitLab merge request environment variable",
    ),
    projectId: readRequiredEnvironmentValue(
      env,
      "CI_PROJECT_ID",
      "GitLab merge request environment variable",
    ),
    mergeRequestIid: readRequiredEnvironmentValue(
      env,
      "CI_MERGE_REQUEST_IID",
      "GitLab merge request environment variable",
    ),
    token: token.token,
    tokenEnv: token.tokenEnv,
  };
}

/** Collects merge request metadata and changed file diffs from GitLab. */
export async function collectGitLabMergeRequestContext(
  options: CollectGitLabMergeRequestContextOptions,
): Promise<GitLabMergeRequestContext> {
  const environment = readGitLabMergeRequestEnvironment(options);
  const client =
    options.client ??
    createGitLabMergeRequestClient({
      apiUrl: environment.apiUrl,
      token: environment.token,
    });

  const [mergeRequest, changedFiles] = await Promise.all([
    client.getMergeRequest(environment.projectId, environment.mergeRequestIid),
    client.listMergeRequestDiffs(
      environment.projectId,
      environment.mergeRequestIid,
    ),
  ]);

  return {
    source: "gitlab-merge-request",
    provider: "gitlab",
    gitlab: {
      apiUrl: environment.apiUrl,
      projectId: environment.projectId,
      mergeRequestIid: environment.mergeRequestIid,
    },
    mergeRequest,
    pullRequest: {
      title: mergeRequest.title,
      description: mergeRequest.description,
      headSha: mergeRequest.diffRefs.headSha,
    },
    changedFiles,
    platform: {
      gitlab: {
        apiUrl: environment.apiUrl,
        projectId: environment.projectId,
        mergeRequestIid: environment.mergeRequestIid,
        diffRefs: mergeRequest.diffRefs,
      },
    },
  };
}

/** Creates a REST-backed GitLab merge request context client. */
export function createGitLabMergeRequestClient({
  apiUrl,
  token,
  ...gitlabOptions
}: CreateGitLabMergeRequestClientOptions): GitLabMergeRequestClient {
  const gitlab = resolveGitLabSdkClient({
    apiUrl,
    token,
    ...gitlabOptions,
  });

  return {
    async getMergeRequest(projectId, mergeRequestIid) {
      const data = asRecord(
        await requestGitLabMergeRequestContext(() =>
          gitlab.MergeRequests.show(
            projectId,
            readGitLabIid(mergeRequestIid, "merge request IID"),
          ),
        ),
        "GitLab API",
      );

      return {
        title: readString(data, "title", "GitLab API"),
        description:
          readOptionalString(data, "description", "GitLab API") ?? "",
        diffRefs: readDiffRefs(data),
      };
    },

    async listMergeRequestDiffs(projectId, mergeRequestIid) {
      const perPage = 100;
      let page = 1;
      const diffs: GitLabDiffFile[] = [];

      for (;;) {
        const items = asArray(
          await requestGitLabMergeRequestContext(() =>
            gitlab.MergeRequests.allDiffs(
              projectId,
              readGitLabIid(mergeRequestIid, "merge request IID"),
              { page, perPage },
            ),
          ),
          "GitLab API",
        );

        for (const item of items) {
          const data = asRecord(item, "GitLab API");

          diffs.push({
            oldPath: readString(data, "old_path", "GitLab API"),
            newPath: readString(data, "new_path", "GitLab API"),
            diff: readString(data, "diff", "GitLab API"),
            newFile: readBoolean(data, "new_file", "GitLab API"),
            renamedFile: readBoolean(data, "renamed_file", "GitLab API"),
            deletedFile: readBoolean(data, "deleted_file", "GitLab API"),
          });
        }

        if (items.length < perPage) {
          return diffs;
        }

        page += 1;
      }
    },
  };
}

async function requestGitLabMergeRequestContext(
  request: () => Promise<unknown>,
): Promise<unknown> {
  try {
    return await request();
  } catch (error) {
    throw toGitLabSdkRequestError("GitLab API request failed", error);
  }
}

function readDiffRefs(data: Record<string, unknown>): GitLabDiffRefs {
  const value = data.diff_refs;

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected GitLab API field diff_refs to be an object");
  }

  const diffRefs = value as Record<string, unknown>;

  return {
    baseSha: readString(diffRefs, "base_sha", "GitLab API"),
    startSha: readString(diffRefs, "start_sha", "GitLab API"),
    headSha: readString(diffRefs, "head_sha", "GitLab API"),
  };
}
