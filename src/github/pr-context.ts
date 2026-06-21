import { readFileSync } from "node:fs";

import {
  createGitHubPullRequestClient,
  type GitHubPullRequestClient,
} from "./client.js";
import type { ReviewTargetContext } from "../platform/types.js";

export type GitHubPullRequestEnvironment = {
  apiUrl: string;
  owner: string;
  repo: string;
  pullNumber: number;
  token: string;
  tokenEnv: string;
};

export type GitHubPullRequestEnvironmentVariables = Record<
  string,
  string | undefined
>;

export type ReadGitHubPullRequestEnvironmentOptions = {
  tokenEnv: string;
  env?: GitHubPullRequestEnvironmentVariables;
};

export type CollectGitHubPullRequestContextOptions =
  ReadGitHubPullRequestEnvironmentOptions & {
    client?: GitHubPullRequestClient;
  };

/** Reads and validates pull request environment variables from GitHub Actions. */
export function readGitHubPullRequestEnvironment({
  tokenEnv,
  env = process.env,
}: ReadGitHubPullRequestEnvironmentOptions): GitHubPullRequestEnvironment {
  const token = readOptionalEnvironmentValue(env, tokenEnv);
  const repository = readOptionalEnvironmentValue(env, "GITHUB_REPOSITORY");
  const eventPath = readOptionalEnvironmentValue(env, "GITHUB_EVENT_PATH");

  if (
    repository === undefined ||
    eventPath === undefined ||
    token === undefined
  ) {
    const missing = [
      ["GITHUB_REPOSITORY", repository],
      ["GITHUB_EVENT_PATH", eventPath],
      [tokenEnv, token],
    ]
      .filter(([, value]) => value === undefined)
      .map(([name]) => name);

    throw new Error(
      `Missing GitHub pull request environment variables: ${missing.join(", ")}`,
    );
  }

  const { owner, repo } = parseGitHubRepository(repository);
  const event = readGitHubEvent(eventPath);

  return {
    apiUrl:
      readOptionalEnvironmentValue(env, "GITHUB_API_URL") ??
      "https://api.github.com",
    owner,
    repo,
    pullNumber: readPullRequestNumber(event),
    token,
    tokenEnv,
  };
}

/** Collects pull request metadata and changed file diffs from GitHub. */
export async function collectGitHubPullRequestContext(
  options: CollectGitHubPullRequestContextOptions,
): Promise<ReviewTargetContext> {
  const environment = readGitHubPullRequestEnvironment(options);
  const client =
    options.client ??
    createGitHubPullRequestClient({
      apiUrl: environment.apiUrl,
      token: environment.token,
    });

  const [pullRequest, changedFiles] = await Promise.all([
    client.getPullRequest(
      environment.owner,
      environment.repo,
      environment.pullNumber,
    ),
    client.listPullRequestDiffs(
      environment.owner,
      environment.repo,
      environment.pullNumber,
    ),
  ]);

  return {
    source: "github-pull-request",
    provider: "github",
    pullRequest,
    changedFiles,
    platform: {
      github: {
        apiUrl: environment.apiUrl,
        owner: environment.owner,
        repo: environment.repo,
        pullNumber: environment.pullNumber,
      },
    },
  };
}

function readOptionalEnvironmentValue(
  env: GitHubPullRequestEnvironmentVariables,
  name: string,
): string | undefined {
  const value = env[name];

  return value === undefined || value.trim().length === 0
    ? undefined
    : value.trim();
}

function parseGitHubRepository(repository: string | undefined): {
  owner: string;
  repo: string;
} {
  const [owner, repo, ...extra] = repository?.split("/") ?? [];

  if (
    owner === undefined ||
    owner.length === 0 ||
    repo === undefined ||
    repo.length === 0 ||
    extra.length > 0
  ) {
    throw new Error("Expected GITHUB_REPOSITORY to be owner/repo");
  }

  return { owner, repo };
}

function readGitHubEvent(eventPath: string | undefined): unknown {
  if (eventPath === undefined) {
    throw new Error(
      "Missing GitHub pull request environment variables: GITHUB_EVENT_PATH",
    );
  }

  try {
    return JSON.parse(readFileSync(eventPath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Cannot read GitHub event file ${eventPath}`, {
      cause: error,
    });
  }
}

function readPullRequestNumber(event: unknown): number {
  const data = asRecord(event, "GitHub event");
  const pullRequest = data.pull_request;
  const inputs = data.inputs;
  const value =
    typeof pullRequest === "object" &&
    pullRequest !== null &&
    !Array.isArray(pullRequest)
      ? (pullRequest as Record<string, unknown>).number
      : data.number;
  const workflowDispatchValue =
    typeof inputs === "object" && inputs !== null && !Array.isArray(inputs)
      ? (inputs as Record<string, unknown>).pr_number
      : undefined;
  const pullRequestNumber = value === undefined ? workflowDispatchValue : value;

  if (
    typeof pullRequestNumber === "number" &&
    Number.isSafeInteger(pullRequestNumber) &&
    pullRequestNumber > 0
  ) {
    return pullRequestNumber;
  }

  if (typeof pullRequestNumber === "string") {
    const parsedNumber = Number(pullRequestNumber);

    if (Number.isSafeInteger(parsedNumber) && parsedNumber > 0) {
      return parsedNumber;
    }
  }

  throw new Error(
    "Expected GitHub pull request event number to be a positive safe integer",
  );
}

function asRecord(value: unknown, source: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error(`Expected ${source} to be an object`);
}
