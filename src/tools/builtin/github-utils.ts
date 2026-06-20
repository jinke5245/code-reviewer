import type { ToolRuntime } from "../types.js";

/** Reads the configured GitHub token for a built-in GitHub tool. */
export function readGitHubToolToken(runtime: ToolRuntime): string {
  const github = runtime.github;

  if (github === undefined) {
    throw new Error("Missing GitHub tool token configuration");
  }

  const token = github.env[github.tokenEnv];

  if (token === undefined || token.trim().length === 0) {
    throw new Error(
      `Missing GitHub tool environment variable: ${github.tokenEnv}`,
    );
  }

  return token;
}
