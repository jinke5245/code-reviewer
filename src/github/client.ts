import type { ChangedFileDiff, PullRequestSummary } from "../platform/types.js";
import {
  asRecord,
  readOptionalString,
  readString,
} from "../platform/response-utils.js";
import { createGitHubOctokit, withGitHubApiError } from "./octokit.js";

export type GitHubPullRequestClient = {
  getPullRequest: (
    owner: string,
    repo: string,
    pullNumber: number,
  ) => Promise<PullRequestSummary>;
  listPullRequestDiffs: (
    owner: string,
    repo: string,
    pullNumber: number,
  ) => Promise<ChangedFileDiff[]>;
};

export type CreateGitHubPullRequestClientOptions = {
  apiUrl: string;
  token: string;
  fetch?: typeof fetch;
};

/** Creates a REST-backed GitHub pull request client. */
export function createGitHubPullRequestClient({
  apiUrl,
  token,
  fetch: fetchImplementation,
}: CreateGitHubPullRequestClientOptions): GitHubPullRequestClient {
  const octokit = createGitHubOctokit({
    apiUrl,
    token,
    ...(fetchImplementation === undefined
      ? {}
      : { fetch: fetchImplementation }),
  });

  return {
    async getPullRequest(owner, repo, pullNumber) {
      const path = `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/${String(pullNumber)}`;
      const data = asRecord(
        (
          await withGitHubApiError(path, () =>
            octokit.rest.pulls.get({
              owner,
              repo,
              pull_number: pullNumber,
            }),
          )
        ).data,
        "GitHub API",
      );
      const head = asRecord(data.head, "GitHub API field head");

      return {
        title: readString(data, "title", "GitHub API"),
        description: readOptionalString(data, "body", "GitHub API") ?? "",
        headSha: readString(head, "sha", "GitHub API"),
      };
    },

    async listPullRequestDiffs(owner, repo, pullNumber) {
      const path = `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls/${String(pullNumber)}/files`;
      const items = await withGitHubApiError(path, () =>
        octokit.paginate(octokit.rest.pulls.listFiles, {
          owner,
          repo,
          pull_number: pullNumber,
          per_page: 100,
        }),
      );

      return items.map(parseGitHubChangedFile);
    },
  };
}

function parseGitHubChangedFile(value: unknown): ChangedFileDiff {
  const data = asRecord(value, "GitHub API");
  const filename = readString(data, "filename", "GitHub API");
  const status = readString(data, "status", "GitHub API");
  const previousFilename = readOptionalString(
    data,
    "previous_filename",
    "GitHub API",
  );

  return {
    oldPath: previousFilename ?? filename,
    newPath: filename,
    diff: readOptionalString(data, "patch", "GitHub API") ?? "",
    newFile: status === "added",
    renamedFile: status === "renamed",
    deletedFile: status === "removed",
  };
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}
