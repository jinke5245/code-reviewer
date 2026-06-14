import type { EnvironmentVariables } from "../env.js";

const defaultGitLabTokenEnv = "GITLAB_TOKEN";
const defaultGitLabTokenEnvCandidates = [
  defaultGitLabTokenEnv,
  "GL_TOKEN",
] as const;

/** A GitLab token read from an environment-variable candidate. */
export type ResolvedGitLabToken = {
  token: string;
  tokenEnv: string;
};

/** Returns the environment variable names accepted for a GitLab token setting. */
export function getGitLabTokenEnvCandidates(tokenEnv: string): readonly string[] {
  return tokenEnv === defaultGitLabTokenEnv
    ? defaultGitLabTokenEnvCandidates
    : [tokenEnv];
}

/** Formats accepted GitLab token env names for diagnostics. */
export function formatGitLabTokenEnvCandidates(tokenEnv: string): string {
  return getGitLabTokenEnvCandidates(tokenEnv).join(" or ");
}

/** Reads a GitLab token, using GL_TOKEN only as a fallback for the default env. */
export function readOptionalGitLabToken(
  env: EnvironmentVariables,
  tokenEnv: string,
): ResolvedGitLabToken | undefined {
  for (const candidate of getGitLabTokenEnvCandidates(tokenEnv)) {
    const value = env[candidate];

    if (value !== undefined && value.trim().length > 0) {
      return {
        token: value,
        tokenEnv: candidate,
      };
    }
  }

  return undefined;
}
