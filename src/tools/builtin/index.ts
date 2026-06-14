import { listGitLabIssuesTool } from "./list-gitlab-issues.js";
import { listGitLabMrsTool } from "./list-gitlab-mrs.js";
import { readDiffTool } from "./read-diff.js";
import { readFileTool } from "./read-file.js";
import { readGitLabMrDiscussionsTool } from "./read-gitlab-mr-discussions.js";
import { readGitLabIssueTool } from "./read-gitlab-issue.js";
import { readGitLabMrTool } from "./read-gitlab-mr.js";
import { repoSearchTool } from "./repo-search.js";
import type { BuiltInToolName, ToolImplementation } from "../types.js";

export const builtInTools: Record<BuiltInToolName, ToolImplementation> = {
  read_diff: readDiffTool,
  read_file: readFileTool,
  repo_search: repoSearchTool,
  read_gitlab_mr: readGitLabMrTool,
  read_gitlab_issue: readGitLabIssueTool,
  list_gitlab_issues: listGitLabIssuesTool,
  list_gitlab_mrs: listGitLabMrsTool,
  read_gitlab_mr_discussions: readGitLabMrDiscussionsTool,
};
