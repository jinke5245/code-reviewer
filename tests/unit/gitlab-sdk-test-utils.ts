import { GitbeakerRequestError } from "@gitbeaker/rest";

import type { GitLabSdkClient } from "../../src/gitlab/client.js";

type GitLabSdkClientOverrides = {
  MergeRequests?: Partial<GitLabSdkClient["MergeRequests"]>;
  Issues?: Partial<GitLabSdkClient["Issues"]>;
  MergeRequestNotes?: Partial<GitLabSdkClient["MergeRequestNotes"]>;
  MergeRequestDiscussions?: Partial<GitLabSdkClient["MergeRequestDiscussions"]>;
};

export function createGitLabSdkClient(
  overrides: GitLabSdkClientOverrides,
): GitLabSdkClient {
  return {
    MergeRequests: {
      all() {
        return Promise.reject(new Error("Unexpected MergeRequests.all call"));
      },
      show() {
        return Promise.reject(new Error("Unexpected MergeRequests.show call"));
      },
      allDiffs() {
        return Promise.reject(
          new Error("Unexpected MergeRequests.allDiffs call"),
        );
      },
      ...overrides.MergeRequests,
    },
    Issues: {
      all() {
        return Promise.reject(new Error("Unexpected Issues.all call"));
      },
      show() {
        return Promise.reject(new Error("Unexpected Issues.show call"));
      },
      ...overrides.Issues,
    },
    MergeRequestNotes: {
      all() {
        return Promise.reject(
          new Error("Unexpected MergeRequestNotes.all call"),
        );
      },
      create() {
        return Promise.reject(
          new Error("Unexpected MergeRequestNotes.create call"),
        );
      },
      ...overrides.MergeRequestNotes,
    },
    MergeRequestDiscussions: {
      all() {
        return Promise.reject(
          new Error("Unexpected MergeRequestDiscussions.all call"),
        );
      },
      create() {
        return Promise.reject(
          new Error("Unexpected MergeRequestDiscussions.create call"),
        );
      },
      ...overrides.MergeRequestDiscussions,
    },
  };
}

export function createGitLabRequestError({
  url,
  status,
  statusText,
}: {
  url: string;
  status: number;
  statusText: string;
}): GitbeakerRequestError {
  const response = new Response(statusText.toLowerCase(), {
    status,
    statusText,
  });

  return new GitbeakerRequestError(statusText.toLowerCase(), {
    cause: {
      description: statusText.toLowerCase(),
      request: new Request(url),
      response,
    },
  });
}
