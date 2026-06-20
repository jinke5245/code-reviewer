import { afterEach, describe, expect, it, vi } from "vitest";

import {
  collectGitLabMergeRequestContext,
  createGitLabMergeRequestClient,
  readGitLabMergeRequestEnvironment,
  type GitLabMergeRequestClient,
} from "../../src/gitlab/mr-context.js";
import {
  readGitLabIid,
  type GitLabSdkClientFactory,
} from "../../src/gitlab/client.js";
import {
  createGitLabRequestError,
  createGitLabSdkClient,
} from "./gitlab-sdk-test-utils.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("readGitLabMergeRequestEnvironment", () => {
  it("reads GitLab merge request CI variables and configured token env", () => {
    const environment = readGitLabMergeRequestEnvironment({
      tokenEnv: "REVIEW_BOT_TOKEN",
      env: {
        CI_API_V4_URL: "https://gitlab.example.test/api/v4",
        CI_PROJECT_ID: "123",
        CI_MERGE_REQUEST_IID: "42",
        REVIEW_BOT_TOKEN: "secret-token",
      },
    });

    expect(environment).toEqual({
      apiUrl: "https://gitlab.example.test/api/v4",
      projectId: "123",
      mergeRequestIid: "42",
      token: "secret-token",
      tokenEnv: "REVIEW_BOT_TOKEN",
    });
  });

  it("falls back to GL_TOKEN when the default GitLab token env is missing", () => {
    const environment = readGitLabMergeRequestEnvironment({
      tokenEnv: "GITLAB_TOKEN",
      env: {
        CI_API_V4_URL: "https://gitlab.example.test/api/v4",
        CI_PROJECT_ID: "123",
        CI_MERGE_REQUEST_IID: "42",
        GL_TOKEN: "gl-token",
      },
    });

    expect(environment).toMatchObject({
      token: "gl-token",
      tokenEnv: "GL_TOKEN",
    });
  });

  it("prefers GITLAB_TOKEN over GL_TOKEN for default GitLab token env", () => {
    const environment = readGitLabMergeRequestEnvironment({
      tokenEnv: "GITLAB_TOKEN",
      env: {
        CI_API_V4_URL: "https://gitlab.example.test/api/v4",
        CI_PROJECT_ID: "123",
        CI_MERGE_REQUEST_IID: "42",
        GITLAB_TOKEN: "gitlab-token",
        GL_TOKEN: "gl-token",
      },
    });

    expect(environment).toMatchObject({
      token: "gitlab-token",
      tokenEnv: "GITLAB_TOKEN",
    });
  });

  it("does not fall back to GL_TOKEN when a custom token env is configured", () => {
    expect(() =>
      readGitLabMergeRequestEnvironment({
        tokenEnv: "REVIEW_BOT_TOKEN",
        env: {
          CI_API_V4_URL: "https://gitlab.example.test/api/v4",
          CI_PROJECT_ID: "123",
          CI_MERGE_REQUEST_IID: "42",
          GL_TOKEN: "gl-token",
        },
      }),
    ).toThrow(/REVIEW_BOT_TOKEN/);
  });

  it("reports missing CI variables with clear names", () => {
    expect(() =>
      readGitLabMergeRequestEnvironment({
        tokenEnv: "GITLAB_TOKEN",
        env: {
          CI_API_V4_URL: "https://gitlab.example.test/api/v4",
          GITLAB_TOKEN: "secret-token",
        },
      }),
    ).toThrow(/CI_PROJECT_ID, CI_MERGE_REQUEST_IID/);
  });

  it("treats blank environment variables as missing", () => {
    expect(() =>
      readGitLabMergeRequestEnvironment({
        tokenEnv: "GITLAB_TOKEN",
        env: {
          CI_API_V4_URL: "   ",
          CI_PROJECT_ID: "123",
          CI_MERGE_REQUEST_IID: "42",
          GITLAB_TOKEN: "",
        },
      }),
    ).toThrow(/CI_API_V4_URL, GITLAB_TOKEN or GL_TOKEN/);
  });
});

describe("readGitLabIid", () => {
  it("accepts positive safe integer strings", () => {
    expect(readGitLabIid("42", "merge request IID")).toBe(42);
  });

  it("rejects zero, unsafe, and non-numeric IIDs", () => {
    expect(() => readGitLabIid("0", "issue IID")).toThrow(
      /Expected GitLab issue IID to be a positive safe integer IID/,
    );
    expect(() => readGitLabIid("9007199254740993", "issue IID")).toThrow(
      /Expected GitLab issue IID to be a positive safe integer IID/,
    );
    expect(() => readGitLabIid("abc", "issue IID")).toThrow(
      /Expected GitLab issue IID to be a positive safe integer IID/,
    );
  });
});

describe("collectGitLabMergeRequestContext", () => {
  it("collects merge request metadata and diffs with a GitLab client", async () => {
    const calls: string[] = [];
    const client: GitLabMergeRequestClient = {
      getMergeRequest(projectId, mergeRequestIid) {
        calls.push(`mr:${projectId}:${mergeRequestIid}`);
        return Promise.resolve({
          title: "Add review context",
          description: "Collect GitLab MR context for dry-run review.",
          diffRefs: {
            baseSha: "base-sha",
            startSha: "start-sha",
            headSha: "head-sha",
          },
        });
      },
      listMergeRequestDiffs(projectId, mergeRequestIid) {
        calls.push(`diffs:${projectId}:${mergeRequestIid}`);
        return Promise.resolve([
          {
            oldPath: "src/old.ts",
            newPath: "src/new.ts",
            diff: "@@\n-export const oldName = true;\n+export const newName = true;",
            newFile: false,
            renamedFile: true,
            deletedFile: false,
          },
        ]);
      },
    };

    const context = await collectGitLabMergeRequestContext({
      tokenEnv: "GITLAB_TOKEN",
      env: {
        CI_API_V4_URL: "https://gitlab.example.test/api/v4",
        CI_PROJECT_ID: "123",
        CI_MERGE_REQUEST_IID: "42",
        GITLAB_TOKEN: "secret-token",
      },
      client,
    });

    expect(calls).toEqual(["mr:123:42", "diffs:123:42"]);
    expect(context).toEqual({
      source: "gitlab-merge-request",
      provider: "gitlab",
      gitlab: {
        apiUrl: "https://gitlab.example.test/api/v4",
        projectId: "123",
        mergeRequestIid: "42",
      },
      mergeRequest: {
        title: "Add review context",
        description: "Collect GitLab MR context for dry-run review.",
        diffRefs: {
          baseSha: "base-sha",
          startSha: "start-sha",
          headSha: "head-sha",
        },
      },
      pullRequest: {
        title: "Add review context",
        description: "Collect GitLab MR context for dry-run review.",
        headSha: "head-sha",
      },
      changedFiles: [
        {
          oldPath: "src/old.ts",
          newPath: "src/new.ts",
          diff: "@@\n-export const oldName = true;\n+export const newName = true;",
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
    });
  });
});

describe("createGitLabMergeRequestClient", () => {
  it("uses GitBeaker to fetch merge request metadata and diffs", async () => {
    const calls: string[] = [];
    const createdClients: Parameters<GitLabSdkClientFactory>[0][] = [];
    const createGitlab: GitLabSdkClientFactory = (options) => {
      createdClients.push(options);

      return createGitLabSdkClient({
        MergeRequests: {
          show(projectId, mergeRequestIid) {
            calls.push(`show:${String(projectId)}:${String(mergeRequestIid)}`);
            return Promise.resolve({
              title: "Improve tests",
              description: null,
              diff_refs: {
                base_sha: "base-sha",
                start_sha: "start-sha",
                head_sha: "head-sha",
              },
            });
          },
          allDiffs(projectId, mergeRequestIid, options) {
            calls.push(
              `diffs:${String(projectId)}:${String(mergeRequestIid)}:${String(options?.perPage)}:${String(options?.page)}`,
            );
            return Promise.resolve([
              {
                old_path: "src/a.ts",
                new_path: "src/a.ts",
                diff: "@@\n+one",
                new_file: false,
                renamed_file: false,
                deleted_file: false,
              },
              {
                old_path: "src/old.ts",
                new_path: "src/new.ts",
                diff: "@@\n+two",
                new_file: false,
                renamed_file: true,
                deleted_file: false,
              },
            ]);
          },
        },
      });
    };

    const client = createGitLabMergeRequestClient({
      apiUrl: "https://gitlab.example.test/api/v4/",
      token: "secret-token",
      createGitlab,
    });

    await expect(
      client.getMergeRequest("group/project", "17"),
    ).resolves.toEqual({
      title: "Improve tests",
      description: "",
      diffRefs: {
        baseSha: "base-sha",
        startSha: "start-sha",
        headSha: "head-sha",
      },
    });
    await expect(
      client.listMergeRequestDiffs("group/project", "17"),
    ).resolves.toEqual([
      {
        oldPath: "src/a.ts",
        newPath: "src/a.ts",
        diff: "@@\n+one",
        newFile: false,
        renamedFile: false,
        deletedFile: false,
      },
      {
        oldPath: "src/old.ts",
        newPath: "src/new.ts",
        diff: "@@\n+two",
        newFile: false,
        renamedFile: true,
        deletedFile: false,
      },
    ]);

    expect(calls).toEqual([
      "show:group/project:17",
      "diffs:group/project:17:100:1",
    ]);
    expect(createdClients).toEqual([
      {
        host: "https://gitlab.example.test",
        token: "secret-token",
      },
    ]);
  });

  it("fetches all merge request diff pages", async () => {
    const calls: string[] = [];
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      old_path: `src/file-${String(index)}.ts`,
      new_path: `src/file-${String(index)}.ts`,
      diff: `@@\n+page one ${String(index)}`,
      new_file: false,
      renamed_file: false,
      deleted_file: false,
    }));
    const secondPage = [
      {
        old_path: "src/last.ts",
        new_path: "src/last.ts",
        diff: "@@\n+page two",
        new_file: false,
        renamed_file: false,
        deleted_file: false,
      },
    ];
    const client = createGitLabMergeRequestClient({
      apiUrl: "https://gitlab.example.test/api/v4",
      token: "secret-token",
      gitlab: createGitLabSdkClient({
        MergeRequests: {
          allDiffs(projectId, mergeRequestIid, options) {
            calls.push(
              `diffs:${String(projectId)}:${String(mergeRequestIid)}:${String(options?.perPage)}:${String(options?.page)}`,
            );

            if (options?.page === 1) {
              return Promise.resolve(firstPage);
            }

            if (options?.page === 2) {
              return Promise.resolve(secondPage);
            }

            throw new Error(`Unexpected diff page: ${String(options?.page)}`);
          },
        },
      }),
    });

    const diffs = await client.listMergeRequestDiffs("123", "42");

    expect(diffs).toHaveLength(101);
    expect(diffs.at(-1)).toEqual({
      oldPath: "src/last.ts",
      newPath: "src/last.ts",
      diff: "@@\n+page two",
      newFile: false,
      renamedFile: false,
      deletedFile: false,
    });
    expect(calls).toEqual(["diffs:123:42:100:1", "diffs:123:42:100:2"]);
  });

  it("reports GitLab SDK request failures with status and endpoint", async () => {
    const client = createGitLabMergeRequestClient({
      apiUrl: "https://gitlab.example.test/api/v4",
      token: "bad-token",
      gitlab: createGitLabSdkClient({
        MergeRequests: {
          show() {
            return Promise.reject(
              createGitLabRequestError({
                url: "https://gitlab.example.test/api/v4/projects/123/merge_requests/42",
                status: 403,
                statusText: "Forbidden",
              }),
            );
          },
        },
      }),
    });

    await expect(client.getMergeRequest("123", "42")).rejects.toThrow(
      /GitLab API request failed: 403 Forbidden .*merge_requests\/42/,
    );
  });

  it("reports malformed merge request responses clearly", async () => {
    const client = createGitLabMergeRequestClient({
      apiUrl: "https://gitlab.example.test/api/v4",
      token: "secret-token",
      gitlab: createGitLabSdkClient({
        MergeRequests: {
          show() {
            return Promise.resolve({
              description: "missing title",
            });
          },
        },
      }),
    });

    await expect(client.getMergeRequest("123", "42")).rejects.toThrow(
      /Expected GitLab API field title to be a string/,
    );
  });

  it("reports malformed diff responses clearly", async () => {
    const client = createGitLabMergeRequestClient({
      apiUrl: "https://gitlab.example.test/api/v4",
      token: "secret-token",
      gitlab: createGitLabSdkClient({
        MergeRequests: {
          allDiffs() {
            return Promise.resolve({ unexpected: true });
          },
        },
      }),
    });

    await expect(client.listMergeRequestDiffs("123", "42")).rejects.toThrow(
      /Expected GitLab API response array/,
    );
  });

  it("reports malformed diff fields clearly", async () => {
    const client = createGitLabMergeRequestClient({
      apiUrl: "https://gitlab.example.test/api/v4",
      token: "secret-token",
      gitlab: createGitLabSdkClient({
        MergeRequests: {
          allDiffs() {
            return Promise.resolve([
              {
                old_path: "src/a.ts",
                new_path: "src/a.ts",
                diff: "@@\n+one",
                new_file: "false",
                renamed_file: false,
                deleted_file: false,
              },
            ]);
          },
        },
      }),
    });

    await expect(client.listMergeRequestDiffs("123", "42")).rejects.toThrow(
      /Expected GitLab API field new_file to be a boolean/,
    );
  });
});
