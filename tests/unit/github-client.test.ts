import { afterEach, describe, expect, it, vi } from "vitest";

import { createGitHubPullRequestClient } from "../../src/github/client.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("createGitHubPullRequestClient", () => {
  it("uses fetch to read pull request metadata and paginated file diffs", async () => {
    const requests: Array<{ authorization: string | null; url: string }> = [];
    const fetchMock: typeof fetch = (input, init) => {
      const request = new Request(input, init);
      requests.push({
        authorization: request.headers.get("authorization"),
        url: request.url,
      });

      if (request.url === "https://api.github.test/repos/acme/repo/pulls/12") {
        return Promise.resolve(
          jsonResponse({
            title: "Add GitHub support",
            body: null,
            head: {
              sha: "head-sha",
            },
          }),
        );
      }

      if (
        request.url ===
        "https://api.github.test/repos/acme/repo/pulls/12/files?per_page=100"
      ) {
        return Promise.resolve(
          jsonResponse(
            [
              {
                filename: "src/new.ts",
                previous_filename: "src/old.ts",
                status: "renamed",
                patch: "@@ -1,1 +1,1 @@\n-old\n+new",
              },
            ],
            {
              link: '<https://api.github.test/repos/acme/repo/pulls/12/files?per_page=100&page=2>; rel="next"',
            },
          ),
        );
      }

      if (
        request.url ===
        "https://api.github.test/repos/acme/repo/pulls/12/files?per_page=100&page=2"
      ) {
        return Promise.resolve(
          jsonResponse([
            {
              filename: "src/deleted.ts",
              status: "removed",
            },
          ]),
        );
      }

      return Promise.resolve(
        new Response("not found", {
          status: 404,
          statusText: "Not Found",
        }),
      );
    };
    globalThis.fetch = vi.fn(fetchMock);
    const client = createGitHubPullRequestClient({
      apiUrl: "https://api.github.test",
      token: "secret-token",
    });

    await expect(client.getPullRequest("acme", "repo", 12)).resolves.toEqual({
      title: "Add GitHub support",
      description: "",
      headSha: "head-sha",
    });
    await expect(
      client.listPullRequestDiffs("acme", "repo", 12),
    ).resolves.toEqual([
      {
        oldPath: "src/old.ts",
        newPath: "src/new.ts",
        diff: "@@ -1,1 +1,1 @@\n-old\n+new",
        newFile: false,
        renamedFile: true,
        deletedFile: false,
      },
      {
        oldPath: "src/deleted.ts",
        newPath: "src/deleted.ts",
        diff: "",
        newFile: false,
        renamedFile: false,
        deletedFile: true,
      },
    ]);
    expect(requests.map((request) => request.authorization)).toEqual([
      "token secret-token",
      "token secret-token",
      "token secret-token",
    ]);
  });

  it("reports GitHub API errors with status and path", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response("boom", {
          status: 500,
          statusText: "Internal Server Error",
        }),
      ),
    );
    const client = createGitHubPullRequestClient({
      apiUrl: "https://api.github.test/",
      token: "secret-token",
    });

    await expect(client.getPullRequest("acme", "repo", 12)).rejects.toThrow(
      /GitHub API request failed: 500 boom \/repos\/acme\/repo\/pulls\/12/,
    );
  });
});

function jsonResponse(
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}
