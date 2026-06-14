import type { ToolRuntime } from "../types.js";
import {
  formatGitLabTokenEnvCandidates,
  readOptionalGitLabToken,
} from "../../gitlab/token-env.js";

/** GitLab tool input fields that may identify an issue or merge request. */
export type GitLabToolTargetInput = {
  iid?: number | undefined;
  projectId?: string | undefined;
  reference?: string | undefined;
};

/** Ensures a GitLab tool target is specified either as a reference or iid/projectId. */
export function assertUnambiguousGitLabTarget(
  input: GitLabToolTargetInput,
): void {
  if (
    input.reference !== undefined &&
    (input.iid !== undefined || input.projectId !== undefined)
  ) {
    throw new Error("Provide either reference or iid/projectId, not both");
  }
}

/** Reads the configured GitLab token for a built-in GitLab tool. */
export function readGitLabToolToken(runtime: ToolRuntime): string {
  const gitlab = runtime.gitlab;

  if (gitlab === undefined) {
    throw new Error("Missing GitLab tool token configuration");
  }

  const { tokenEnv } = gitlab;
  const token = readOptionalGitLabToken(gitlab.env, tokenEnv);

  if (token === undefined) {
    throw new Error(
      `Missing GitLab tool environment variable: ${formatGitLabTokenEnvCandidates(tokenEnv)}`,
    );
  }

  return token.token;
}
