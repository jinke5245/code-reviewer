import type { z } from "zod";

import type { GitLabMergeRequestContext } from "../gitlab/mr-context.js";

/** Names of built-in read-only tools available to the review model. */
export type BuiltInToolName =
  | "read_diff"
  | "read_file"
  | "repo_search"
  | "read_gitlab_mr"
  | "read_gitlab_issue"
  | "list_gitlab_issues"
  | "list_gitlab_mrs"
  | "read_gitlab_mr_discussions";

/** Limits applied to model-driven tool execution. */
export type ToolLimits = {
  maxToolCalls: number;
  maxBytesPerToolResult: number;
  maxTotalContextBytes: number;
  timeoutMs: number;
};

/** Capability permissions that gate model-driven tool execution. */
export type ToolPermissions = {
  readRepo: boolean;
  readGitLab: boolean;
  shell: boolean;
  network: boolean;
  write: boolean;
};

/** Tool invocation requested by the model. */
export type ToolCall = {
  name: string;
  arguments: unknown;
};

/** Runtime context provided to a tool implementation. */
export type ToolRuntime = {
  cwd: string;
  context: GitLabMergeRequestContext;
  limits: ToolLimits;
  gitlab?: {
    tokenEnv: string;
    env: Record<string, string | undefined>;
  };
};

/** Tool implementation registered with a tool runner. */
export type ToolImplementation = {
  inputSchema: z.ZodType;
  execute: (args: unknown, runtime: ToolRuntime) => Promise<unknown>;
};

/** Executes validated tool calls under configured limits. */
export type ToolRunner = {
  execute: (call: ToolCall) => Promise<unknown>;
};
