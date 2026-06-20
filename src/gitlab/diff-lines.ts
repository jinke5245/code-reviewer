export type GitLabDiffSide = "new" | "old";
export type {
  DiffLine as GitLabDiffLine,
  DiffRange as GitLabDiffRange,
} from "../platform/diff-lines.js";
export {
  findDiffRangeForCode as findGitLabDiffRangeForCode,
  parseUnifiedDiffLines as parseGitLabDiffLines,
  readDiffRangeCode as readGitLabDiffRangeCode,
} from "../platform/diff-lines.js";
