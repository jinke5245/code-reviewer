/** Names of code-hosting providers supported by Code Reviewer. */
export type ReviewProviderName = "gitlab" | "github";

/** Publish mode used for one review run. */
export type ReviewPublishMode = "dry-run" | "summary" | "inline";

/** Side of a diff finding anchor. */
export type DiffSide = "new" | "old";

/** A changed file diff from a pull request-like review target. */
export type ChangedFileDiff = {
  oldPath: string;
  newPath: string;
  diff: string;
  newFile: boolean;
  renamedFile: boolean;
  deletedFile: boolean;
};

/** Sanitized metadata for the pull request-like target being reviewed. */
export type PullRequestSummary = {
  title: string;
  description: string;
  headSha: string;
};

/** Complete review target context passed to prompts, tools, and publishers. */
export type ReviewTargetContext = {
  source: "gitlab-merge-request" | "github-pull-request";
  provider: ReviewProviderName;
  pullRequest: PullRequestSummary;
  changedFiles: ChangedFileDiff[];
  platform: {
    gitlab?: {
      apiUrl: string;
      projectId: string;
      mergeRequestIid: string;
      diffRefs: {
        baseSha: string;
        startSha: string;
        headSha: string;
      };
    };
    github?: {
      apiUrl: string;
      owner: string;
      repo: string;
      pullNumber: number;
    };
  };
};
