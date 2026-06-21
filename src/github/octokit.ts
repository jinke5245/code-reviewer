import { Octokit } from "@octokit/rest";

export type GitHubOctokit = InstanceType<typeof Octokit>;

export type CreateGitHubOctokitOptions = {
  apiUrl: string;
  token: string;
  fetch?: typeof fetch;
};

/** Creates the shared Octokit client used by GitHub adapters. */
export function createGitHubOctokit({
  apiUrl,
  token,
  fetch: fetchImplementation,
}: CreateGitHubOctokitOptions): GitHubOctokit {
  return new Octokit({
    auth: token,
    baseUrl: apiUrl.trim().replace(/\/+$/u, ""),
    ...(fetchImplementation === undefined
      ? {}
      : {
          request: {
            fetch: fetchImplementation,
          },
        }),
  });
}

/** Normalizes Octokit errors into the package's GitHub API error wording. */
export async function withGitHubApiError<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(
      `GitHub API request failed: ${readGitHubErrorStatus(error)} ${readGitHubErrorMessage(error)} ${path}`,
      {
        cause: error,
      },
    );
  }
}

function readGitHubErrorStatus(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return String(error.status);
  }

  return "unknown";
}

function readGitHubErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Error";
}
