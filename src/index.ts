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
  ReviewPublishMode,
  ReviewRunOverview,
} from "./gitlab/review-publication-plan.js";
export { loadReviewTemplates } from "./gitlab/review-templates.js";
export type {
  LoadedReviewTemplates,
  LoadReviewTemplatesOptions,
} from "./gitlab/review-templates.js";
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
