import type { CodeReviewerConfig } from "../config/schema.js";
import type { ReviewProviderName } from "./types.js";

/** Resolves the review provider from explicit config or CI environment. */
export function resolveReviewProviderName({
  config,
  env,
}: {
  config: Pick<CodeReviewerConfig, "provider">;
  env: Record<string, string | undefined>;
}): ReviewProviderName {
  if (config.provider === "gitlab" || config.provider === "github") {
    return config.provider;
  }

  const hasGitHub =
    env.GITHUB_ACTIONS === "true" && hasText(env.GITHUB_EVENT_PATH);
  const hasGitLab =
    hasText(env.CI_API_V4_URL) &&
    hasText(env.CI_PROJECT_ID) &&
    hasText(env.CI_MERGE_REQUEST_IID);

  if (hasGitHub && !hasGitLab) {
    return "github";
  }

  if (hasGitLab && !hasGitHub) {
    return "gitlab";
  }

  if (hasGitHub && hasGitLab) {
    throw new Error(
      "Both GitHub and GitLab review environments were detected; set provider to github or gitlab.",
    );
  }

  throw new Error(
    "Cannot detect review provider. Set provider to github or gitlab, or run in GitHub Actions pull_request context or GitLab merge request CI.",
  );
}

function hasText(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}
