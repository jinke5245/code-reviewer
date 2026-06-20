import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  collectGitHubPullRequestContext,
  readGitHubPullRequestEnvironment,
} from "../../src/github/pr-context.js";
import type { GitHubPullRequestClient } from "../../src/github/client.js";

describe("readGitHubPullRequestEnvironment", () => {
  it("reads GitHub Actions pull request variables and configured token", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-github-event-"));
    const eventPath = join(cwd, "event.json");
    await writeFile(eventPath, JSON.stringify({ pull_request: { number: 12 } }));

    expect(
      readGitHubPullRequestEnvironment({
        tokenEnv: "REVIEW_GITHUB_TOKEN",
        env: {
          GITHUB_ACTIONS: "true",
          GITHUB_REPOSITORY: "acme/repo",
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_API_URL: "https://github.example.test/api/v3",
          REVIEW_GITHUB_TOKEN: "secret-token",
        },
      }),
    ).toEqual({
      apiUrl: "https://github.example.test/api/v3",
      owner: "acme",
      repo: "repo",
      pullNumber: 12,
      token: "secret-token",
      tokenEnv: "REVIEW_GITHUB_TOKEN",
    });
  });

  it("reports missing GitHub environment variables with clear names", () => {
    expect(() =>
      readGitHubPullRequestEnvironment({
        tokenEnv: "GITHUB_TOKEN",
        env: {
          GITHUB_ACTIONS: "true",
        },
      }),
    ).toThrow(/Missing GitHub pull request environment variables/);
  });
});

describe("collectGitHubPullRequestContext", () => {
  it("collects pull request metadata and diffs with a GitHub client", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-github-event-"));
    const eventPath = join(cwd, "event.json");
    const calls: string[] = [];
    await writeFile(eventPath, JSON.stringify({ pull_request: { number: 12 } }));

    const client: GitHubPullRequestClient = {
      getPullRequest(owner, repo, pullNumber) {
        calls.push(`pr:${owner}:${repo}:${String(pullNumber)}`);
        return Promise.resolve({
          title: "Add GitHub review",
          description: "Review a GitHub pull request.",
          headSha: "head-sha",
        });
      },
      listPullRequestDiffs(owner, repo, pullNumber) {
        calls.push(`diffs:${owner}:${repo}:${String(pullNumber)}`);
        return Promise.resolve([
          {
            oldPath: "src/old.ts",
            newPath: "src/new.ts",
            diff: "@@ -1,1 +1,1 @@\n-old\n+new",
            newFile: false,
            renamedFile: true,
            deletedFile: false,
          },
        ]);
      },
    };

    const context = await collectGitHubPullRequestContext({
      tokenEnv: "GITHUB_TOKEN",
      env: {
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: "acme/repo",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_TOKEN: "secret-token",
      },
      client,
    });

    expect(calls).toEqual(["pr:acme:repo:12", "diffs:acme:repo:12"]);
    expect(context).toEqual({
      source: "github-pull-request",
      provider: "github",
      pullRequest: {
        title: "Add GitHub review",
        description: "Review a GitHub pull request.",
        headSha: "head-sha",
      },
      changedFiles: [
        {
          oldPath: "src/old.ts",
          newPath: "src/new.ts",
          diff: "@@ -1,1 +1,1 @@\n-old\n+new",
          newFile: false,
          renamedFile: true,
          deletedFile: false,
        },
      ],
      platform: {
        github: {
          apiUrl: "https://api.github.com",
          owner: "acme",
          repo: "repo",
          pullNumber: 12,
        },
      },
    });
  });
});
