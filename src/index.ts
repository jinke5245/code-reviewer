/**
 * Public API for embedding Code Reviewer in tests, custom CI wrappers, or
 * higher-level automation.
 */
export { createCli, main } from "./cli.js";
export type { CliRuntime } from "./cli.js";
export { loadConfig } from "./config/load-config.js";
export type { LoadConfigOptions } from "./config/load-config.js";
export { configSchema, toolNameSchema } from "./config/schema.js";
export type { CodeReviewerConfig } from "./config/schema.js";
export { readRequiredEnvironmentValue } from "./env.js";
export type { EnvironmentVariables } from "./env.js";
export { createGitHubPullRequestClient } from "./github/client.js";
export type {
  CreateGitHubPullRequestClientOptions,
  GitHubPullRequestClient,
} from "./github/client.js";
export {
  collectGitHubPullRequestContext,
  readGitHubPullRequestEnvironment,
} from "./github/pr-context.js";
export type {
  CollectGitHubPullRequestContextOptions,
  GitHubPullRequestEnvironment,
  GitHubPullRequestEnvironmentVariables,
  ReadGitHubPullRequestEnvironmentOptions,
} from "./github/pr-context.js";
export {
  createGitHubInlineCommentBody,
  createGitHubInlineCommentFingerprint,
  createGitHubSummaryCommentBody,
  createGitHubSummaryCommentFingerprint,
} from "./github/review-formatting.js";
export {
  createGitHubPullRequestCommentsClient,
  publishPullRequestInlineComments,
  publishPullRequestSummaryComment,
} from "./github/pull-request-comments.js";
export type {
  CreateGitHubPullRequestCommentsClientOptions,
  GitHubIssueComment,
  GitHubPullRequestCommentsClient,
  GitHubReviewComment,
  GitHubReviewCommentCreateInput,
  PublishPullRequestInlineCommentsResult,
  PublishPullRequestSummaryCommentResult,
} from "./github/pull-request-comments.js";
export {
  createGitHubReviewPublicationPlan,
  mapFindingToGitHubPosition,
} from "./github/review-publication-plan.js";
export type {
  GitHubInlineFinding,
  GitHubReviewCommentPosition,
  GitHubReviewCommentSide,
  GitHubReviewPublicationPlan,
  GitHubReviewRunOverview,
} from "./github/review-publication-plan.js";
export {
  createGitLabSdkClient,
  gitLabApiUrlToHost,
  readGitLabIid,
  resolveGitLabSdkClient,
  toGitLabSdkRequestError,
} from "./gitlab/client.js";
export type {
  CreateGitLabSdkClientOptions,
  GitLabSdkClient,
  GitLabSdkClientFactory,
  GitLabSdkClientInjection,
} from "./gitlab/client.js";
export {
  collectGitLabMergeRequestContext,
  createGitLabMergeRequestClient,
  readGitLabMergeRequestEnvironment,
} from "./gitlab/mr-context.js";
export type {
  GitLabDiffFile,
  GitLabDiffRefs,
  CollectGitLabMergeRequestContextOptions,
  CreateGitLabMergeRequestClientOptions,
  GitLabMergeRequestClient,
  GitLabMergeRequestContext,
  GitLabMergeRequestEnvironment,
  GitLabMergeRequestEnvironmentVariables,
  GitLabMergeRequestSummary,
  ReadGitLabMergeRequestEnvironmentOptions,
} from "./gitlab/mr-context.js";
export {
  createGitLabReferenceContextClient,
  parseGitLabReference,
} from "./gitlab/reference-context.js";
export type {
  CreateGitLabReferenceContextClientOptions,
  GitLabReadableIssue,
  GitLabReadableIssueSummary,
  GitLabReadableMergeRequest,
  GitLabReadableMergeRequestSummary,
  GitLabReferenceContextClient,
  GitLabReferenceKind,
  GitLabReferenceTarget,
  ListGitLabReferencesOptions,
} from "./gitlab/reference-context.js";
export {
  createGitLabMergeRequestDiscussionClient,
  createInlineDiscussionBody,
  createInlineDiscussionFingerprint,
  publishMergeRequestInlineDiscussions,
} from "./gitlab/inline-discussions.js";
export type {
  CreateGitLabMergeRequestDiscussionClientOptions,
  CreateInlineDiscussionBodyOptions,
  CreateInlineDiscussionFingerprintOptions,
  GitLabMergeRequestDiscussion,
  GitLabMergeRequestDiscussionClient,
  GitLabMergeRequestDiscussionNote,
  PublishMergeRequestInlineDiscussionsOptions,
  PublishMergeRequestInlineDiscussionsResult,
} from "./gitlab/inline-discussions.js";
export {
  createReviewPublicationPlan,
  mapFindingToDiffPosition,
} from "./gitlab/review-publication-plan.js";
export type {
  CreateReviewPublicationPlanOptions,
  GitLabTextPosition,
  MapFindingToDiffPositionOptions,
  ReviewInlineFinding,
  ReviewPublicationPlan,
  ReviewRunOverview,
} from "./gitlab/review-publication-plan.js";
export { loadReviewTemplates } from "./review/review-templates.js";
export type {
  LoadedReviewTemplates,
  LoadReviewTemplatesOptions,
} from "./review/review-templates.js";
export {
  createGitLabMergeRequestNoteClient,
  createSummaryNoteBody,
  createSummaryNoteFingerprint,
  publishMergeRequestSummaryNote,
} from "./gitlab/summary-note.js";
export type {
  CreateGitLabMergeRequestNoteClientOptions,
  GitLabMergeRequestNote,
  GitLabMergeRequestNoteClient,
  PublishMergeRequestSummaryNoteOptions,
  PublishMergeRequestSummaryNoteResult,
} from "./gitlab/summary-note.js";
export { createOpenAICompatibleReviewModel } from "./model/openai-compatible.js";
export type {
  CreateOpenAICompatibleReviewModelOptions,
  OpenAICompatibleToolDefinition,
} from "./model/openai-compatible.js";
export { readPackageInfo } from "./package-info.js";
export type { PackageInfo } from "./package-info.js";
export {
  findDiffRangeForCode,
  parseUnifiedDiffLines,
  readDiffRangeCode,
} from "./platform/diff-lines.js";
export type { DiffLine, DiffRange } from "./platform/diff-lines.js";
export { resolveReviewProviderName } from "./platform/provider.js";
export type {
  ChangedFileDiff,
  DiffSide,
  PullRequestSummary,
  ReviewProviderName,
  ReviewPublishMode,
  ReviewTargetContext,
} from "./platform/types.js";
export { formatReviewFindingSeverity } from "./review/formatting.js";
export {
  loadReviewPrompts,
  summarizeReviewPrompts,
} from "./prompt/review-prompts.js";
export type {
  LoadReviewPromptsOptions,
  LoadedReviewPrompts,
  ReviewPromptSummary,
} from "./prompt/review-prompts.js";
export { runReviewLoop } from "./review/loop.js";
export type {
  ExecutedReviewToolCall,
  ReviewLoopOptions,
  ReviewLoopResult,
  ReviewModel,
  ReviewModelMessage,
  ReviewModelRequest,
  ReviewModelResponse,
  ReviewToolCall,
} from "./review/loop.js";
export { parseReviewReport } from "./review/report.js";
export type {
  ParseReviewReportOptions,
  ReviewFinding,
  ReviewFindingSide,
  ReviewFindingSeverity,
  ReviewReport,
  ReviewToolCallSummary,
} from "./review/report.js";
export { createToolRunner } from "./tools/runner.js";
export type {
  BuiltInToolName,
  CreateToolRunnerOptions,
  ToolCall,
  ToolImplementation,
  ToolLimits,
  ToolPermissions,
  ToolRunner,
  ToolRuntime,
} from "./tools/runner.js";
