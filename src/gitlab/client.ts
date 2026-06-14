import { GitbeakerRequestError, Gitlab } from "@gitbeaker/rest";

/** Minimal GitBeaker surface used by Code Reviewer. */
export type GitLabSdkClient = {
  MergeRequests: {
    all: (options?: {
      projectId?: string | number;
      perPage?: number;
      maxPages?: number;
      state?: string;
      search?: string;
    }) => Promise<unknown>;
    show: (
      projectId: string | number,
      mergeRequestIid: number,
    ) => Promise<unknown>;
    allDiffs: (
      projectId: string | number,
      mergeRequestIid: number,
      options?: { page?: number; perPage?: number },
    ) => Promise<unknown>;
  };
  Issues: {
    all: (options?: {
      projectId?: string | number;
      perPage?: number;
      maxPages?: number;
      state?: string;
      search?: string;
    }) => Promise<unknown>;
    show: (
      issueIid: number,
      options?: { projectId?: string | number },
    ) => Promise<unknown>;
  };
  MergeRequestNotes: {
    all: (
      projectId: string | number,
      mergeRequestIid: number,
      options?: { perPage?: number },
    ) => Promise<unknown>;
    create: (
      projectId: string | number,
      mergeRequestIid: number,
      body: string,
    ) => Promise<unknown>;
  };
  MergeRequestDiscussions: {
    all: (
      projectId: string | number,
      mergeRequestIid: number,
      options?: { perPage?: number },
    ) => Promise<unknown>;
    create: (
      projectId: string | number,
      mergeRequestIid: number,
      body: string,
      options?: { position?: Record<string, unknown> },
    ) => Promise<unknown>;
  };
};

export type CreateGitLabSdkClientOptions = {
  host: string;
  token: string;
};

export type GitLabSdkClientFactory = (
  options: CreateGitLabSdkClientOptions,
) => GitLabSdkClient;

export type GitLabSdkClientInjection = {
  gitlab?: GitLabSdkClient;
  createGitlab?: GitLabSdkClientFactory;
};

/** Creates the GitBeaker client used for GitLab REST API calls. */
export function createGitLabSdkClient({
  host,
  token,
}: CreateGitLabSdkClientOptions): GitLabSdkClient {
  return new Gitlab({
    host,
    token,
  }) as GitLabSdkClient;
}

/** Resolves a GitLab API v4 URL to the instance host expected by GitBeaker. */
export function gitLabApiUrlToHost(apiUrl: string): string {
  const normalized = apiUrl.trim().replace(/\/+$/u, "");
  const apiSuffix = "/api/v4";

  return normalized.endsWith(apiSuffix)
    ? normalized.slice(0, -apiSuffix.length)
    : normalized;
}

export function resolveGitLabSdkClient({
  apiUrl,
  token,
  gitlab,
  createGitlab = createGitLabSdkClient,
}: {
  apiUrl: string;
  token: string;
} & GitLabSdkClientInjection): GitLabSdkClient {
  return (
    gitlab ??
    createGitlab({
      host: gitLabApiUrlToHost(apiUrl),
      token,
    })
  );
}

export function readGitLabIid(value: string | number, name: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/u.test(value)) {
    const parsed = Number(value);

    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  throw new Error(`Expected GitLab ${name} to be a positive safe integer IID`);
}

export function toGitLabSdkRequestError(prefix: string, error: unknown): Error {
  if (error instanceof GitbeakerRequestError && error.cause !== undefined) {
    const response = error.cause.response;
    const requestUrl = new URL(error.cause.request.url);

    return new Error(
      `${prefix}: ${String(response.status)} ${response.statusText} ${requestUrl.pathname}`,
      { cause: error },
    );
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(`${prefix}: ${String(error)}`);
}
