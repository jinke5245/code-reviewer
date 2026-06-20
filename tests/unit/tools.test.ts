import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { GitLabMergeRequestContext } from "../../src/gitlab/mr-context.js";
import type { ReviewTargetContext } from "../../src/platform/types.js";
import {
  isSearchableRepositoryFile,
  listSearchableRepositoryFiles,
} from "../../src/tools/builtin/repo-search.js";
import { readGitLabToolToken } from "../../src/tools/builtin/gitlab-utils.js";
import {
  createToolRunner,
  type ToolImplementation,
} from "../../src/tools/runner.js";
import type { ToolRuntime } from "../../src/tools/types.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("built-in read-only tools", () => {
  it("reads a changed file diff by new path or old path", async () => {
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createContext(),
    });

    await expect(
      runner.execute({
        name: "read_diff",
        arguments: {
          path: "src/new.ts",
        },
      }),
    ).resolves.toEqual({
      path: "src/new.ts",
      oldPath: "src/old.ts",
      newPath: "src/new.ts",
      diff: "@@ -1,1 +1,1 @@\n-old\n+new",
      lines: [
        {
          kind: "deleted",
          oldLine: 1,
          text: "old",
        },
        {
          kind: "added",
          newLine: 1,
          text: "new",
        },
      ],
    });

    await expect(
      runner.execute({
        name: "read_diff",
        arguments: {
          path: "src/old.ts",
        },
      }),
    ).resolves.toMatchObject({
      path: "src/old.ts",
      oldPath: "src/old.ts",
      newPath: "src/new.ts",
    });
  });

  it("reads repository-local files", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-tools-"));
    await writeFile(join(cwd, "source.ts"), "export const answer = 42;\n");

    const runner = createToolRunner({
      cwd,
      context: createContext(),
    });

    await expect(
      runner.execute({
        name: "read_file",
        arguments: {
          path: "source.ts",
        },
      }),
    ).resolves.toEqual({
      path: "source.ts",
      content: "export const answer = 42;\n",
      lines: [
        {
          line: 1,
          text: "export const answer = 42;",
        },
      ],
    });
  });

  it("searches repository files without using shell commands", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-tools-"));
    await writeFile(join(cwd, "source.ts"), "export const needle = 42;\n");
    await writeFile(join(cwd, "other.ts"), "export const value = needle;\n");

    const runner = createToolRunner({
      cwd,
      context: createContext(),
    });

    await expect(
      runner.execute({
        name: "repo_search",
        arguments: {
          query: "needle",
        },
      }),
    ).resolves.toEqual({
      query: "needle",
      matches: [
        {
          path: "other.ts",
          line: 1,
          text: "export const value = needle;",
        },
        {
          path: "source.ts",
          line: 1,
          text: "export const needle = 42;",
        },
      ],
      searchedFiles: 2,
      truncated: false,
    });
  });

  it("limits repository search results", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-tools-"));
    await writeFile(
      join(cwd, "source.ts"),
      ["needle one", "needle two", "needle three"].join("\n"),
    );

    const runner = createToolRunner({
      cwd,
      context: createContext(),
    });

    await expect(
      runner.execute({
        name: "repo_search",
        arguments: {
          query: "needle",
          limit: 2,
        },
      }),
    ).resolves.toEqual({
      query: "needle",
      matches: [
        {
          path: "source.ts",
          line: 1,
          text: "needle one",
        },
        {
          path: "source.ts",
          line: 2,
          text: "needle two",
        },
      ],
      searchedFiles: 1,
      truncated: true,
    });
  });

  it("does not count oversized files toward repository search file limits", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-tools-"));
    await writeFile(join(cwd, "a-large.txt"), `${"x".repeat(1024 * 1024)}x`);
    await writeFile(join(cwd, "b-large.txt"), `${"x".repeat(1024 * 1024)}x`);
    await writeFile(join(cwd, "source.ts"), "const needle = true;\n");
    await writeFile(join(cwd, "z-other.ts"), "const needle = false;\n");

    const runner = createToolRunner({
      cwd,
      context: createContext(),
    });

    await expect(
      runner.execute({
        name: "repo_search",
        arguments: {
          query: "needle",
          maxFiles: 1,
        },
      }),
    ).resolves.toEqual({
      query: "needle",
      matches: [
        {
          path: "source.ts",
          line: 1,
          text: "const needle = true;",
        },
      ],
      searchedFiles: 1,
      truncated: true,
    });
  });

  it("does not search repository symlinks that resolve outside the repository", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-tools-"));
    await writeFile(join(tmpdir(), "codereviewer-secret.txt"), "needle");
    await symlink(
      join(tmpdir(), "codereviewer-secret.txt"),
      join(cwd, "outside.txt"),
    );

    const runner = createToolRunner({
      cwd,
      context: createContext(),
    });

    await expect(
      runner.execute({
        name: "repo_search",
        arguments: {
          query: "needle",
        },
      }),
    ).resolves.toEqual({
      query: "needle",
      matches: [],
      searchedFiles: 0,
      truncated: false,
    });
  });

  it("ignores generated directories and oversized files during repository search", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-tools-"));
    await mkdir(join(cwd, "src"));
    await mkdir(join(cwd, "node_modules"));
    await mkdir(join(cwd, "dist"));
    await mkdir(join(cwd, "public"));
    await writeFile(join(cwd, "src", "source.ts"), "const needle = true;\n");
    await writeFile(
      join(cwd, "node_modules", "ignored.ts"),
      "const needle = false;\n",
    );
    await writeFile(join(cwd, "dist", "ignored.ts"), "const needle = false;\n");
    await writeFile(
      join(cwd, "public", "ignored.js"),
      "const needle = false;\n",
    );
    await writeFile(join(cwd, "large.txt"), `${"x".repeat(1024 * 1024)}needle`);

    const runner = createToolRunner({
      cwd,
      context: createContext(),
    });

    await expect(
      runner.execute({
        name: "repo_search",
        arguments: {
          query: "needle",
        },
      }),
    ).resolves.toEqual({
      query: "needle",
      matches: [
        {
          path: "src/source.ts",
          line: 1,
          text: "const needle = true;",
        },
      ],
      searchedFiles: 1,
      truncated: false,
    });
  });

  it("classifies searchable repository files by current file type and size", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-tools-"));
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "small.ts"), "const needle = true;\n");
    await writeFile(join(cwd, "large.ts"), `${"x".repeat(1024 * 1024)}x`);

    await expect(
      isSearchableRepositoryFile(join(cwd, "small.ts")),
    ).resolves.toBe(true);
    await expect(
      isSearchableRepositoryFile(join(cwd, "large.ts")),
    ).resolves.toBe(false);
    await expect(isSearchableRepositoryFile(join(cwd, "src"))).resolves.toBe(
      false,
    );
  });

  it("returns repository search files with reusable real paths", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-tools-"));
    const sourcePath = join(cwd, "source.ts");
    await writeFile(sourcePath, "const needle = true;\n");

    await expect(listSearchableRepositoryFiles(cwd, 10)).resolves.toEqual({
      files: [
        {
          path: "source.ts",
          filePath: await realpath(sourcePath),
        },
      ],
      truncated: false,
    });
  });

  it("returns merge request context without exposing the token", async () => {
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createContext(),
    });

    await expect(
      runner.execute({
        name: "read_gitlab_mr",
        arguments: {},
      }),
    ).resolves.toEqual({
      source: "gitlab-merge-request",
      gitlab: {
        apiUrl: "https://gitlab.example.test/api/v4",
        projectId: "123",
        mergeRequestIid: "42",
      },
      mergeRequest: {
        title: "Add tools",
        description: "Give the model safe context tools.",
        diffRefs: {
          baseSha: "base-sha",
          startSha: "start-sha",
          headSha: "head-sha",
        },
      },
      changedFiles: [
        {
          oldPath: "src/old.ts",
          newPath: "src/new.ts",
          newFile: false,
          renamedFile: true,
          deletedFile: false,
        },
      ],
    });
  });

  it("returns GitHub pull request context without exposing the token", async () => {
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createGitHubContext(),
    });

    await expect(
      runner.execute({
        name: "read_github_pr",
        arguments: {},
      }),
    ).resolves.toEqual({
      source: "github-pull-request",
      github: {
        apiUrl: "https://api.github.test",
        owner: "acme",
        repo: "repo",
        pullNumber: 12,
      },
      pullRequest: {
        title: "Add GitHub tools",
        description: "Give the model safe GitHub context tools.",
        headSha: "head-sha",
      },
      changedFiles: [
        {
          oldPath: "src/old.ts",
          newPath: "src/new.ts",
          newFile: false,
          renamedFile: true,
          deletedFile: false,
        },
      ],
    });
  });

  it("reads GitHub pull request comments", async () => {
    const requests: Array<{ authorization: string | null; url: string }> = [];
    const fetchMock: typeof fetch = (input, init) => {
      const request = new Request(input, init);
      requests.push({
        authorization: request.headers.get("authorization"),
        url: request.url,
      });

      if (
        request.url ===
        "https://api.github.test/repos/acme/repo/issues/12/comments?per_page=100"
      ) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 101,
              body: "Summary comment",
              user: { login: "reviewer" },
              html_url: "https://github.test/comment/101",
              created_at: "2026-06-20T00:00:00Z",
              updated_at: "2026-06-20T00:01:00Z",
            },
          ]),
        );
      }

      if (
        request.url ===
        "https://api.github.test/repos/acme/repo/pulls/12/comments?per_page=100"
      ) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 202,
              body: "Inline comment",
              user: { login: "reviewer" },
              path: "src/new.ts",
              side: "RIGHT",
              line: 4,
              start_line: 3,
              html_url: "https://github.test/comment/202",
              created_at: "2026-06-20T00:02:00Z",
              updated_at: "2026-06-20T00:03:00Z",
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
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createGitHubContext(),
      github: {
        tokenEnv: "GITHUB_TOKEN",
        env: {
          GITHUB_TOKEN: "secret-token",
        },
      },
    });

    await expect(
      runner.execute({
        name: "read_github_pr_comments",
        arguments: {},
      }),
    ).resolves.toEqual({
      owner: "acme",
      repo: "repo",
      pullNumber: 12,
      issueComments: [
        {
          id: 101,
          body: "Summary comment",
          authorLogin: "reviewer",
          htmlUrl: "https://github.test/comment/101",
          createdAt: "2026-06-20T00:00:00Z",
          updatedAt: "2026-06-20T00:01:00Z",
        },
      ],
      reviewComments: [
        {
          id: 202,
          body: "Inline comment",
          authorLogin: "reviewer",
          path: "src/new.ts",
          side: "RIGHT",
          line: 4,
          startLine: 3,
          htmlUrl: "https://github.test/comment/202",
          createdAt: "2026-06-20T00:02:00Z",
          updatedAt: "2026-06-20T00:03:00Z",
        },
      ],
    });
    expect(requests.map((request) => request.authorization)).toEqual([
      "token secret-token",
      "token secret-token",
    ]);
  });

  it("does not read GitHub comments from another pull request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    globalThis.fetch = fetchMock;
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createGitHubContext(),
      github: {
        tokenEnv: "GITHUB_TOKEN",
        env: {
          GITHUB_TOKEN: "secret-token",
        },
      },
    });

    await expect(
      runner.execute({
        name: "read_github_pr_comments",
        arguments: {
          number: 99,
        },
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops paginating GitHub comments after reaching the requested limit", async () => {
    const requests: string[] = [];
    const fetchMock: typeof fetch = (input, init) => {
      const request = new Request(input, init);
      requests.push(request.url);

      if (
        request.url ===
        "https://api.github.test/repos/acme/repo/issues/12/comments?per_page=1"
      ) {
        return Promise.resolve(
          jsonResponse(
            [
              {
                id: 101,
                body: "Summary comment",
              },
            ],
            {
              link: '<https://api.github.test/repos/acme/repo/issues/12/comments?per_page=1&page=2>; rel="next"',
            },
          ),
        );
      }

      if (
        request.url ===
        "https://api.github.test/repos/acme/repo/pulls/12/comments?per_page=1"
      ) {
        return Promise.resolve(
          jsonResponse(
            [
              {
                id: 201,
                body: "Inline comment",
              },
            ],
            {
              link: '<https://api.github.test/repos/acme/repo/pulls/12/comments?per_page=1&page=2>; rel="next"',
            },
          ),
        );
      }

      if (request.url.includes("page=2")) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 999,
              body: "Should not be fetched",
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
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createGitHubContext(),
      github: {
        tokenEnv: "GITHUB_TOKEN",
        env: {
          GITHUB_TOKEN: "secret-token",
        },
      },
    });

    await expect(
      runner.execute({
        name: "read_github_pr_comments",
        arguments: {
          limit: 1,
        },
      }),
    ).resolves.toMatchObject({
      issueComments: [{ id: 101 }],
      reviewComments: [{ id: 201 }],
    });
    expect(requests).toEqual([
      "https://api.github.test/repos/acme/repo/issues/12/comments?per_page=1",
      "https://api.github.test/repos/acme/repo/pulls/12/comments?per_page=1",
    ]);
  });

  it("denies GitHub tools when platform reads are disabled", async () => {
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createGitHubContext(),
      permissions: {
        readPlatform: false,
      },
    });

    await expect(
      runner.execute({
        name: "read_github_pr",
        arguments: {},
      }),
    ).rejects.toThrow(
      /Tool permission denied: read_github_pr requires readPlatform/,
    );
  });

  it("keeps GitHub platform reads enabled when only GitLab reads are disabled", async () => {
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createGitHubContext(),
      permissions: {
        readGitLab: false,
      },
    });

    await expect(
      runner.execute({
        name: "read_github_pr",
        arguments: {},
      }),
    ).resolves.toMatchObject({
      github: {
        owner: "acme",
        pullNumber: 12,
        repo: "repo",
      },
      pullRequest: {
        title: "Add GitHub tools",
      },
    });
    await expect(
      runner.execute({
        name: "read_gitlab_mr",
        arguments: {},
      }),
    ).rejects.toThrow(
      /Tool permission denied: read_gitlab_mr requires readGitLab/,
    );
  });

  it("reads a GitLab issue from the current project by iid", async () => {
    const requests: Array<{ url: string; token: string | null }> = [];
    const fetchMock: typeof fetch = (input, init) => {
      const headers = fetchInputHeaders(input, init);
      const url = fetchInputUrl(input);
      requests.push({
        url,
        token: headers.get("PRIVATE-TOKEN"),
      });

      if (url === "https://gitlab.example.test/api/v4/projects/123/issues/7") {
        return Promise.resolve(
          jsonResponse({
            iid: 7,
            title: "Clarify behavior",
            description: "The review should consider this requirement.",
            state: "opened",
            labels: ["review"],
            web_url: "https://gitlab.example.test/project/issues/7",
          }),
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
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createContext(),
      gitlab: {
        tokenEnv: "GITLAB_TOKEN",
        env: {
          GITLAB_TOKEN: "secret-token",
        },
      },
    });

    await expect(
      runner.execute({
        name: "read_gitlab_issue",
        arguments: {
          iid: 7,
        },
      }),
    ).resolves.toEqual({
      projectId: "123",
      iid: 7,
      title: "Clarify behavior",
      description: "The review should consider this requirement.",
      state: "opened",
      labels: ["review"],
      webUrl: "https://gitlab.example.test/project/issues/7",
    });
    expect(requests).toEqual([
      {
        url: "https://gitlab.example.test/api/v4/projects/123/issues/7",
        token: "secret-token",
      },
    ]);
  });

  it("reads current-project GitLab references by shorthand", async () => {
    const requests: string[] = [];
    const fetchMock: typeof fetch = (input) => {
      const url = fetchInputUrl(input);
      requests.push(url);

      if (url === "https://gitlab.example.test/api/v4/projects/123/issues/7") {
        return Promise.resolve(
          jsonResponse({
            iid: 7,
            title: "Current issue",
            description: null,
            state: "opened",
            labels: [],
            web_url: "https://gitlab.example.test/project/issues/7",
          }),
        );
      }

      if (
        url ===
        "https://gitlab.example.test/api/v4/projects/123/merge_requests/8"
      ) {
        return Promise.resolve(
          jsonResponse({
            iid: 8,
            title: "Current MR",
            description: null,
            state: "opened",
            labels: [],
            web_url: "https://gitlab.example.test/project/merge_requests/8",
            source_branch: "feature",
            target_branch: "main",
          }),
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
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createContext(),
      gitlab: {
        tokenEnv: "GITLAB_TOKEN",
        env: {
          GITLAB_TOKEN: "secret-token",
        },
      },
    });

    await expect(
      runner.execute({
        name: "read_gitlab_issue",
        arguments: {
          reference: "#7",
        },
      }),
    ).resolves.toMatchObject({
      projectId: "123",
      iid: 7,
      title: "Current issue",
    });
    await expect(
      runner.execute({
        name: "read_gitlab_mr",
        arguments: {
          reference: "!8",
        },
      }),
    ).resolves.toMatchObject({
      projectId: "123",
      iid: 8,
      title: "Current MR",
    });
    expect(requests).toEqual([
      "https://gitlab.example.test/api/v4/projects/123/issues/7",
      "https://gitlab.example.test/api/v4/projects/123/merge_requests/8",
    ]);
  });

  it("reads cross-project GitLab issues and merge requests by reference", async () => {
    const requests: string[] = [];
    const fetchMock: typeof fetch = (input) => {
      const url = fetchInputUrl(input);
      requests.push(url);

      if (
        url ===
        "https://gitlab.example.test/api/v4/projects/group%2Fother/issues/12"
      ) {
        return Promise.resolve(
          jsonResponse({
            iid: 12,
            title: "Cross-project issue",
            description: null,
            state: "closed",
            labels: [],
            web_url: "https://gitlab.example.test/group/other/-/issues/12",
          }),
        );
      }

      if (
        url ===
        "https://gitlab.example.test/api/v4/projects/group%2Fother/merge_requests/34"
      ) {
        return Promise.resolve(
          jsonResponse({
            iid: 34,
            title: "Cross-project MR",
            description: "Relevant implementation detail.",
            state: "merged",
            labels: ["backend"],
            web_url:
              "https://gitlab.example.test/group/other/-/merge_requests/34",
            source_branch: "feature",
            target_branch: "main",
          }),
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
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createContext(),
      gitlab: {
        tokenEnv: "GITLAB_TOKEN",
        env: {
          GITLAB_TOKEN: "secret-token",
        },
      },
    });

    await expect(
      runner.execute({
        name: "read_gitlab_issue",
        arguments: {
          reference: "group/other#12",
        },
      }),
    ).resolves.toMatchObject({
      projectId: "group/other",
      iid: 12,
      title: "Cross-project issue",
      state: "closed",
    });
    await expect(
      runner.execute({
        name: "read_gitlab_mr",
        arguments: {
          reference: "group/other!34",
        },
      }),
    ).resolves.toEqual({
      projectId: "group/other",
      iid: 34,
      title: "Cross-project MR",
      description: "Relevant implementation detail.",
      state: "merged",
      labels: ["backend"],
      webUrl: "https://gitlab.example.test/group/other/-/merge_requests/34",
      sourceBranch: "feature",
      targetBranch: "main",
    });
    expect(requests).toEqual([
      "https://gitlab.example.test/api/v4/projects/group%2Fother/issues/12",
      "https://gitlab.example.test/api/v4/projects/group%2Fother/merge_requests/34",
    ]);
  });

  it("lists current-project GitLab issues and merge requests", async () => {
    const requests: string[] = [];
    const fetchMock: typeof fetch = (input) => {
      const url = fetchInputUrl(input);
      requests.push(url);

      if (isGitLabApiPath(url, "/projects/123/issues")) {
        return Promise.resolve(
          jsonResponse([
            {
              iid: 7,
              title: "Clarify expected review scope",
              state: "opened",
              labels: ["review"],
              web_url: "https://gitlab.example.test/project/issues/7",
            },
          ]),
        );
      }

      if (isGitLabApiPath(url, "/projects/123/merge_requests")) {
        return Promise.resolve(
          jsonResponse([
            {
              iid: 8,
              title: "Implement MVP",
              state: "opened",
              labels: ["mvp"],
              web_url: "https://gitlab.example.test/project/merge_requests/8",
              source_branch: "feature/mvp",
              target_branch: "main",
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
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createContext(),
      gitlab: {
        tokenEnv: "GITLAB_TOKEN",
        env: {
          GITLAB_TOKEN: "secret-token",
        },
      },
    });

    await expect(
      runner.execute({
        name: "list_gitlab_issues",
        arguments: {},
      }),
    ).resolves.toEqual({
      projectId: "123",
      issues: [
        {
          projectId: "123",
          iid: 7,
          title: "Clarify expected review scope",
          state: "opened",
          labels: ["review"],
          webUrl: "https://gitlab.example.test/project/issues/7",
        },
      ],
    });
    await expect(
      runner.execute({
        name: "list_gitlab_mrs",
        arguments: {},
      }),
    ).resolves.toEqual({
      projectId: "123",
      mergeRequests: [
        {
          projectId: "123",
          iid: 8,
          title: "Implement MVP",
          state: "opened",
          labels: ["mvp"],
          webUrl: "https://gitlab.example.test/project/merge_requests/8",
          sourceBranch: "feature/mvp",
          targetBranch: "main",
        },
      ],
    });
    expect(requests).toHaveLength(2);
    expect(new URL(requests[0] ?? "").searchParams.get("per_page")).toBe("100");
    expect(new URL(requests[1] ?? "").searchParams.get("per_page")).toBe("100");
  });

  it("reads current-project and referenced merge request discussions", async () => {
    const requests: string[] = [];
    const fetchMock: typeof fetch = (input) => {
      const url = fetchInputUrl(input);
      requests.push(url);

      if (isGitLabApiPath(url, "/projects/123/merge_requests/42/discussions")) {
        return Promise.resolve(
          jsonResponse([
            {
              id: "discussion-1",
              individual_note: false,
              notes: [
                {
                  id: 10,
                  body: "Existing inline review comment",
                  author: {
                    username: "review-bot",
                  },
                  system: false,
                  resolvable: true,
                  resolved: false,
                  created_at: "2026-06-01T10:00:00.000Z",
                  updated_at: "2026-06-01T10:05:00.000Z",
                  web_url:
                    "https://gitlab.example.test/project/merge_requests/42#note_10",
                },
              ],
            },
          ]),
        );
      }

      if (
        isGitLabApiPath(
          url,
          "/projects/group%2Fother/merge_requests/34/discussions",
        )
      ) {
        return Promise.resolve(
          jsonResponse([
            {
              id: "discussion-2",
              individual_note: true,
              notes: [
                {
                  id: 11,
                  body: "Cross-project summary note",
                  author: {
                    username: "maintainer",
                  },
                  system: false,
                  resolvable: false,
                  resolved: null,
                  created_at: "2026-06-01T11:00:00.000Z",
                  updated_at: "2026-06-01T11:00:00.000Z",
                  web_url:
                    "https://gitlab.example.test/group/other/-/merge_requests/34#note_11",
                },
              ],
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
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createContext(),
      gitlab: {
        tokenEnv: "GITLAB_TOKEN",
        env: {
          GITLAB_TOKEN: "secret-token",
        },
      },
    });

    await expect(
      runner.execute({
        name: "read_gitlab_mr_discussions",
        arguments: {},
      }),
    ).resolves.toEqual({
      projectId: "123",
      iid: 42,
      discussions: [
        {
          id: "discussion-1",
          individualNote: false,
          notes: [
            {
              id: 10,
              body: "Existing inline review comment",
              authorUsername: "review-bot",
              system: false,
              resolvable: true,
              resolved: false,
              createdAt: "2026-06-01T10:00:00.000Z",
              updatedAt: "2026-06-01T10:05:00.000Z",
              webUrl:
                "https://gitlab.example.test/project/merge_requests/42#note_10",
            },
          ],
        },
      ],
    });
    await expect(
      runner.execute({
        name: "read_gitlab_mr_discussions",
        arguments: {
          reference: "group/other!34",
        },
      }),
    ).resolves.toMatchObject({
      projectId: "group/other",
      iid: 34,
      discussions: [
        {
          id: "discussion-2",
          individualNote: true,
          notes: [
            {
              id: 11,
              body: "Cross-project summary note",
              authorUsername: "maintainer",
              resolvable: false,
            },
          ],
        },
      ],
    });
    expect(requests).toEqual([
      "https://gitlab.example.test/api/v4/projects/123/merge_requests/42/discussions?per_page=100",
      "https://gitlab.example.test/api/v4/projects/group%2Fother/merge_requests/34/discussions?per_page=100",
    ]);
  });

  it("lists cross-project GitLab issues and merge requests with filters", async () => {
    const requests: string[] = [];
    const fetchMock: typeof fetch = (input) => {
      const url = fetchInputUrl(input);
      requests.push(url);

      if (isGitLabApiPath(url, "/projects/group%2Fother/issues")) {
        return Promise.resolve(
          jsonResponse([
            {
              iid: 12,
              title: "Closed scope issue",
              state: "closed",
              labels: ["scope"],
              web_url: "https://gitlab.example.test/group/other/-/issues/12",
            },
          ]),
        );
      }

      if (isGitLabApiPath(url, "/projects/group%2Fother/merge_requests")) {
        return Promise.resolve(
          jsonResponse([
            {
              iid: 34,
              title: "Merged MVP MR",
              state: "merged",
              labels: ["mvp"],
              web_url:
                "https://gitlab.example.test/group/other/-/merge_requests/34",
              source_branch: "feature/mvp",
              target_branch: "main",
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
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createContext(),
      gitlab: {
        tokenEnv: "GITLAB_TOKEN",
        env: {
          GITLAB_TOKEN: "secret-token",
        },
      },
    });

    await expect(
      runner.execute({
        name: "list_gitlab_issues",
        arguments: {
          projectId: "group/other",
          state: "closed",
          search: "scope",
          limit: 2,
        },
      }),
    ).resolves.toMatchObject({
      projectId: "group/other",
      issues: [
        {
          projectId: "group/other",
          iid: 12,
          title: "Closed scope issue",
        },
      ],
    });
    await expect(
      runner.execute({
        name: "list_gitlab_mrs",
        arguments: {
          projectId: "group/other",
          state: "merged",
          search: "mvp",
          limit: 2,
        },
      }),
    ).resolves.toMatchObject({
      projectId: "group/other",
      mergeRequests: [
        {
          projectId: "group/other",
          iid: 34,
          title: "Merged MVP MR",
        },
      ],
    });

    const issueUrl = new URL(requests[0] ?? "");
    const mergeRequestUrl = new URL(requests[1] ?? "");

    expect(issueUrl.pathname).toBe("/api/v4/projects/group%2Fother/issues");
    expect(issueUrl.searchParams.get("state")).toBe("closed");
    expect(issueUrl.searchParams.get("search")).toBe("scope");
    expect(issueUrl.searchParams.get("per_page")).toBe("2");
    expect(mergeRequestUrl.pathname).toBe(
      "/api/v4/projects/group%2Fother/merge_requests",
    );
    expect(mergeRequestUrl.searchParams.get("state")).toBe("merged");
    expect(mergeRequestUrl.searchParams.get("search")).toBe("mvp");
    expect(mergeRequestUrl.searchParams.get("per_page")).toBe("2");
  });
});

describe("tool safety and limits", () => {
  it("rejects disabled tools", async () => {
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createContext(),
      enabledTools: ["read_diff"],
    });

    await expect(
      runner.execute({
        name: "read_file",
        arguments: {
          path: "source.ts",
        },
      }),
    ).rejects.toThrow(/Tool is not enabled: read_file/);
  });

  it("rejects repository path traversal", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-tools-"));
    const runner = createToolRunner({
      cwd,
      context: createContext(),
    });

    await expect(
      runner.execute({
        name: "read_file",
        arguments: {
          path: "../outside.txt",
        },
      }),
    ).rejects.toThrow(/Path must stay inside the repository/);
  });

  it("rejects absolute repository paths", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-tools-"));
    const runner = createToolRunner({
      cwd,
      context: createContext(),
    });

    await expect(
      runner.execute({
        name: "read_file",
        arguments: {
          path: join(cwd, "source.ts"),
        },
      }),
    ).rejects.toThrow(/Path must stay inside the repository/);
  });

  it("rejects repository symlinks that resolve outside the repository", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-tools-"));
    await writeFile(join(tmpdir(), "codereviewer-outside.txt"), "secret");
    await symlink(
      join(tmpdir(), "codereviewer-outside.txt"),
      join(cwd, "outside.txt"),
    );
    const runner = createToolRunner({
      cwd,
      context: createContext(),
    });

    await expect(
      runner.execute({
        name: "read_file",
        arguments: {
          path: "outside.txt",
        },
      }),
    ).rejects.toThrow(/Path must stay inside the repository/);
  });

  it("schema-validates tool input before execution", async () => {
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createContext(),
    });

    await expect(
      runner.execute({
        name: "repo_search",
        arguments: {
          query: "",
        },
      }),
    ).rejects.toThrow(/Too small/);
  });

  it("enforces configured tool permissions", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-tools-"));
    await writeFile(join(cwd, "source.ts"), "export const value = 1;\n");
    const readRepoRunner = createToolRunner({
      cwd,
      context: createContext(),
      permissions: {
        readRepo: false,
      },
    });
    const readGitLabRunner = createToolRunner({
      cwd,
      context: createContext(),
      permissions: {
        readGitLab: false,
      },
    });

    await expect(
      readRepoRunner.execute({
        name: "read_file",
        arguments: {
          path: "source.ts",
        },
      }),
    ).rejects.toThrow(/Tool permission denied: read_file requires readRepo/);
    await expect(
      readRepoRunner.execute({
        name: "repo_search",
        arguments: {
          query: "value",
        },
      }),
    ).rejects.toThrow(/Tool permission denied: repo_search requires readRepo/);
    await expect(
      readRepoRunner.execute({
        name: "read_diff",
        arguments: {
          path: "src/new.ts",
        },
      }),
    ).rejects.toThrow(/Tool permission denied: read_diff requires readRepo/);
    await expect(
      readGitLabRunner.execute({
        name: "read_diff",
        arguments: {
          path: "src/new.ts",
        },
      }),
    ).resolves.toEqual({
      path: "src/new.ts",
      oldPath: "src/old.ts",
      newPath: "src/new.ts",
      diff: "@@ -1,1 +1,1 @@\n-old\n+new",
      lines: [
        {
          kind: "deleted",
          oldLine: 1,
          text: "old",
        },
        {
          kind: "added",
          newLine: 1,
          text: "new",
        },
      ],
    });
    await expect(
      readGitLabRunner.execute({
        name: "read_gitlab_mr",
        arguments: {},
      }),
    ).rejects.toThrow(
      /Tool permission denied: read_gitlab_mr requires readGitLab/,
    );
    await expect(
      readGitLabRunner.execute({
        name: "list_gitlab_issues",
        arguments: {},
      }),
    ).rejects.toThrow(
      /Tool permission denied: list_gitlab_issues requires readGitLab/,
    );
    await expect(
      readGitLabRunner.execute({
        name: "list_gitlab_mrs",
        arguments: {},
      }),
    ).rejects.toThrow(
      /Tool permission denied: list_gitlab_mrs requires readGitLab/,
    );
    await expect(
      readGitLabRunner.execute({
        name: "read_gitlab_mr_discussions",
        arguments: {},
      }),
    ).rejects.toThrow(
      /Tool permission denied: read_gitlab_mr_discussions requires readGitLab/,
    );
  });

  it("reports missing repository files clearly", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-tools-"));
    const runner = createToolRunner({
      cwd,
      context: createContext(),
    });

    await expect(
      runner.execute({
        name: "read_file",
        arguments: {
          path: "missing.ts",
        },
      }),
    ).rejects.toThrow(/Cannot read repository file missing\.ts/);
  });

  it("rejects unknown diff paths", async () => {
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createContext(),
    });

    await expect(
      runner.execute({
        name: "read_diff",
        arguments: {
          path: "src/missing.ts",
        },
      }),
    ).rejects.toThrow(/No changed file diff found for path: src\/missing\.ts/);
  });

  it("rejects mismatched GitLab issue and merge request references", async () => {
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createContext(),
      gitlab: {
        tokenEnv: "GITLAB_TOKEN",
        env: {
          GITLAB_TOKEN: "secret-token",
        },
      },
    });

    await expect(
      runner.execute({
        name: "read_gitlab_issue",
        arguments: {
          reference: "group/other!34",
        },
      }),
    ).rejects.toThrow(/Expected an issue reference/);
    await expect(
      runner.execute({
        name: "read_gitlab_mr",
        arguments: {
          reference: "group/other#12",
        },
      }),
    ).rejects.toThrow(/Expected a merge request reference/);
    await expect(
      runner.execute({
        name: "read_gitlab_mr_discussions",
        arguments: {
          reference: "group/other#12",
        },
      }),
    ).rejects.toThrow(/Expected a merge request reference/);
  });

  it("rejects ambiguous GitLab reference inputs", async () => {
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createContext(),
      gitlab: {
        tokenEnv: "GITLAB_TOKEN",
        env: {
          GITLAB_TOKEN: "secret-token",
        },
      },
    });

    await expect(
      runner.execute({
        name: "read_gitlab_issue",
        arguments: {
          iid: 1,
          reference: "#2",
        },
      }),
    ).rejects.toThrow(/Provide either reference or iid\/projectId/);
    await expect(
      runner.execute({
        name: "read_gitlab_mr",
        arguments: {
          projectId: "group/other",
          reference: "!2",
        },
      }),
    ).rejects.toThrow(/Provide either reference or iid\/projectId/);
    await expect(
      runner.execute({
        name: "read_gitlab_mr_discussions",
        arguments: {
          iid: 1,
          reference: "!2",
        },
      }),
    ).rejects.toThrow(/Provide either reference or iid\/projectId/);
  });

  it("rejects GitLab issue reads without an issue IID or reference", async () => {
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createContext(),
      gitlab: {
        tokenEnv: "GITLAB_TOKEN",
        env: {
          GITLAB_TOKEN: "secret-token",
        },
      },
    });

    await expect(
      runner.execute({
        name: "read_gitlab_issue",
        arguments: {},
      }),
    ).rejects.toThrow(
      /read_gitlab_issue requires an issue iid or reference; there is no default current issue/,
    );
  });

  it("reports missing GitLab token for API-backed GitLab tools", async () => {
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createContext(),
      gitlab: {
        tokenEnv: "GITLAB_TOKEN",
        env: {},
      },
    });

    await expect(
      runner.execute({
        name: "read_gitlab_issue",
        arguments: {
          iid: 1,
        },
      }),
    ).rejects.toThrow(
      /Missing GitLab tool environment variable: GITLAB_TOKEN or GL_TOKEN/,
    );
    await expect(
      runner.execute({
        name: "list_gitlab_issues",
        arguments: {},
      }),
    ).rejects.toThrow(
      /Missing GitLab tool environment variable: GITLAB_TOKEN or GL_TOKEN/,
    );
    await expect(
      runner.execute({
        name: "list_gitlab_mrs",
        arguments: {},
      }),
    ).rejects.toThrow(
      /Missing GitLab tool environment variable: GITLAB_TOKEN or GL_TOKEN/,
    );
    await expect(
      runner.execute({
        name: "read_gitlab_mr_discussions",
        arguments: {},
      }),
    ).rejects.toThrow(
      /Missing GitLab tool environment variable: GITLAB_TOKEN or GL_TOKEN/,
    );
  });

  it("falls back to GL_TOKEN for default GitLab tool token configuration", () => {
    expect(
      readGitLabToolToken(
        createGitLabToolRuntime({
          tokenEnv: "GITLAB_TOKEN",
          env: {
            GL_TOKEN: "gl-token",
          },
        }),
      ),
    ).toBe("gl-token");
  });

  it("prefers GITLAB_TOKEN over GL_TOKEN for default GitLab tool token configuration", () => {
    expect(
      readGitLabToolToken(
        createGitLabToolRuntime({
          tokenEnv: "GITLAB_TOKEN",
          env: {
            GITLAB_TOKEN: "gitlab-token",
            GL_TOKEN: "gl-token",
          },
        }),
      ),
    ).toBe("gitlab-token");
  });

  it("does not fall back to GL_TOKEN for custom GitLab tool token configuration", () => {
    expect(() =>
      readGitLabToolToken(
        createGitLabToolRuntime({
          tokenEnv: "REVIEW_BOT_TOKEN",
          env: {
            GL_TOKEN: "gl-token",
          },
        }),
      ),
    ).toThrow(/Missing GitLab tool environment variable: REVIEW_BOT_TOKEN/);
  });

  it("rejects invalid GitLab list limits before calling the API", async () => {
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createContext(),
      gitlab: {
        tokenEnv: "GITLAB_TOKEN",
        env: {
          GITLAB_TOKEN: "secret-token",
        },
      },
    });

    await expect(
      runner.execute({
        name: "list_gitlab_issues",
        arguments: {
          limit: 101,
        },
      }),
    ).rejects.toThrow(/Too big/);
    await expect(
      runner.execute({
        name: "list_gitlab_mrs",
        arguments: {
          limit: 0,
        },
      }),
    ).rejects.toThrow(/Too small/);
    await expect(
      runner.execute({
        name: "read_gitlab_mr_discussions",
        arguments: {
          limit: 101,
        },
      }),
    ).rejects.toThrow(/Too big/);
  });

  it("reports GitLab reference API failures and malformed payloads clearly", async () => {
    const fetchMock: typeof fetch = (input) => {
      const url = fetchInputUrl(input);

      if (
        url === "https://gitlab.example.test/api/v4/projects/123/issues/404"
      ) {
        return Promise.resolve(
          new Response("not found", {
            status: 404,
            statusText: "Not Found",
          }),
        );
      }

      if (url === "https://gitlab.example.test/api/v4/projects/123/issues/5") {
        return Promise.resolve(
          jsonResponse({
            iid: 5,
            title: "Malformed issue",
            description: null,
            state: "opened",
            labels: [123],
            web_url: "https://gitlab.example.test/project/issues/5",
          }),
        );
      }

      return Promise.resolve(
        new Response("unexpected", {
          status: 500,
          statusText: "Unexpected",
        }),
      );
    };
    globalThis.fetch = vi.fn(fetchMock);
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createContext(),
      gitlab: {
        tokenEnv: "GITLAB_TOKEN",
        env: {
          GITLAB_TOKEN: "secret-token",
        },
      },
    });

    await expect(
      runner.execute({
        name: "read_gitlab_issue",
        arguments: {
          iid: 404,
        },
      }),
    ).rejects.toThrow(
      /GitLab reference API request failed: 404 Not Found .*projects\/123\/issues\/404/,
    );
    await expect(
      runner.execute({
        name: "read_gitlab_issue",
        arguments: {
          iid: 5,
        },
      }),
    ).rejects.toThrow(
      /Expected GitLab reference API field labels to be a string array/,
    );
  });

  it("enforces max tool calls", async () => {
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createContext(),
      limits: {
        maxToolCalls: 1,
      },
    });

    await runner.execute({
      name: "read_gitlab_mr",
      arguments: {},
    });

    await expect(
      runner.execute({
        name: "read_gitlab_mr",
        arguments: {},
      }),
    ).rejects.toThrow(/Tool call limit exceeded/);
  });

  it("enforces per-tool result size", async () => {
    const largeTool: ToolImplementation = {
      inputSchema: z.object({}),
      execute() {
        return Promise.resolve({
          content: "x".repeat(200),
        });
      },
    };
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createContext(),
      enabledTools: ["large_tool"],
      limits: {
        maxBytesPerToolResult: 50,
      },
      tools: {
        large_tool: largeTool,
      },
    });

    await expect(
      runner.execute({
        name: "large_tool",
        arguments: {},
      }),
    ).rejects.toThrow(/Tool result exceeds maxBytesPerToolResult/);
  });

  it("rejects oversized repository files before reading them", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-tools-"));
    await writeFile(join(cwd, "large.txt"), "x".repeat(200));
    const runner = createToolRunner({
      cwd,
      context: createContext(),
      limits: {
        maxBytesPerToolResult: 50,
      },
    });

    await expect(
      runner.execute({
        name: "read_file",
        arguments: {
          path: "large.txt",
        },
      }),
    ).rejects.toThrow(/Repository file exceeds maxBytesPerToolResult/);
  });

  it("enforces total context size", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-tools-"));
    await writeFile(join(cwd, "small.txt"), "hello");
    const runner = createToolRunner({
      cwd,
      context: createContext(),
      limits: {
        maxTotalContextBytes: 100,
      },
    });

    await runner.execute({
      name: "read_file",
      arguments: {
        path: "small.txt",
      },
    });

    await expect(
      runner.execute({
        name: "read_gitlab_mr",
        arguments: {},
      }),
    ).rejects.toThrow(/Tool results exceed maxTotalContextBytes/);
  });

  it("enforces tool timeout", async () => {
    const slowTool: ToolImplementation = {
      inputSchema: z.object({}),
      execute() {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({ ok: true });
          }, 25);
        });
      },
    };
    const runner = createToolRunner({
      cwd: await mkdtemp(join(tmpdir(), "codereviewer-tools-")),
      context: createContext(),
      enabledTools: ["slow_tool"],
      limits: {
        timeoutMs: 1,
      },
      tools: {
        slow_tool: slowTool,
      },
    });

    await expect(
      runner.execute({
        name: "slow_tool",
        arguments: {},
      }),
    ).rejects.toThrow(/Tool timed out: slow_tool/);
  });
});

function createContext(): GitLabMergeRequestContext {
  return {
    source: "gitlab-merge-request",
    provider: "gitlab",
    gitlab: {
      apiUrl: "https://gitlab.example.test/api/v4",
      projectId: "123",
      mergeRequestIid: "42",
    },
    mergeRequest: {
      title: "Add tools",
      description: "Give the model safe context tools.",
      diffRefs: {
        baseSha: "base-sha",
        startSha: "start-sha",
        headSha: "head-sha",
      },
    },
    pullRequest: {
      title: "Add tools",
      description: "Give the model safe context tools.",
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
      gitlab: {
        apiUrl: "https://gitlab.example.test/api/v4",
        projectId: "123",
        mergeRequestIid: "42",
        diffRefs: {
          baseSha: "base-sha",
          startSha: "start-sha",
          headSha: "head-sha",
        },
      },
    },
  };
}

function createGitHubContext(): ReviewTargetContext {
  return {
    source: "github-pull-request",
    provider: "github",
    pullRequest: {
      title: "Add GitHub tools",
      description: "Give the model safe GitHub context tools.",
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
        apiUrl: "https://api.github.test",
        owner: "acme",
        repo: "repo",
        pullNumber: 12,
      },
    },
  };
}

function createGitLabToolRuntime(
  gitlab: NonNullable<ToolRuntime["gitlab"]>,
): ToolRuntime {
  return {
    cwd: tmpdir(),
    context: createContext(),
    limits: {
      maxToolCalls: 120,
      maxBytesPerToolResult: 1000000,
      maxTotalContextBytes: 8000000,
      timeoutMs: 60000,
    },
    gitlab,
  };
}

function jsonResponse(
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

function fetchInputUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.href;
  }

  return input.url;
}

function fetchInputHeaders(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): Headers {
  if (input instanceof Request) {
    return input.headers;
  }

  return new Headers(init?.headers);
}

function isGitLabApiPath(url: string, path: string): boolean {
  const parsed = new URL(url);

  return (
    parsed.origin === "https://gitlab.example.test" &&
    parsed.pathname === `/api/v4${path}`
  );
}
