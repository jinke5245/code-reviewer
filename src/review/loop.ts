import { z } from "zod";

import { reviewFindingEvidenceInstructions } from "./finding-evidence-contract.js";
import { stringifyLogValue } from "../log-value.js";
import { formatErrorMessage } from "../tools/format-error.js";
import type { ToolCall, ToolRunner } from "../tools/types.js";

/** Tool call requested by a review model. */
export type ReviewToolCall = {
  id?: string;
  name: string;
  arguments: unknown;
};

/** Chat-style message exchanged with a review model. */
export type ReviewModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ReviewToolCall[];
};

/** Request sent to a review model for one loop round. */
export type ReviewModelRequest = {
  messages: ReviewModelMessage[];
  round: number;
  maxRounds: number;
  remainingToolCalls: number;
  responseFormat?: "review_report";
};

/** Response returned by a review model. */
export type ReviewModelResponse = {
  content?: string;
  toolCalls?: ReviewToolCall[];
};

/** Model adapter used by the review loop. */
export type ReviewModel = {
  complete: (request: ReviewModelRequest) => Promise<ReviewModelResponse>;
};

/** Progress event emitted by the review loop for diagnostics and CI logs. */
export type ReviewLoopEvent =
  | {
      type: "model_request";
      round: number;
      maxRounds: number;
      remainingToolCalls: number;
      responseFormat?: ReviewModelRequest["responseFormat"];
    }
  | {
      type: "tool_call";
      arguments: string;
      round: number;
      name: string;
    }
  | {
      type: "tool_result";
      failed: boolean;
      name: string;
      resultBytes: number;
      round: number;
    }
  | {
      type: "final_report_request";
      round: number;
      maxRounds: number;
    };

/** Tool call plus the result returned by the tool runner. */
export type ExecutedReviewToolCall = ReviewToolCall & {
  result: unknown;
};

/** Final result of a completed review loop. */
export type ReviewLoopResult = {
  finalMessage: string;
  rounds: number;
  toolCalls: ExecutedReviewToolCall[];
};

/** Options for executing a bounded review loop. */
export type ReviewLoopOptions = {
  finalReportInstructions?: string[];
  maxRounds: number;
  maxToolCalls: number;
  messages: ReviewModelMessage[];
  model: ReviewModel;
  onEvent?: (event: ReviewLoopEvent) => void;
  toolRunner: ToolRunner;
};

const reviewToolCallSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1),
    arguments: z.unknown().default({}),
  })
  .loose()
  .transform(
    (call): ReviewToolCall => ({
      ...(call.id === undefined ? {} : { id: call.id }),
      name: call.name,
      arguments: call.arguments,
    }),
  );

const jsonToolCallEnvelopeSchema = z
  .object({
    tool_calls: z.array(reviewToolCallSchema).optional(),
    toolCalls: z.array(reviewToolCallSchema).optional(),
  })
  .loose();

/** Runs the model/tool conversation until final content is produced. */
export async function runReviewLoop({
  finalReportInstructions = [],
  maxRounds,
  maxToolCalls,
  messages,
  model,
  onEvent,
  toolRunner,
}: ReviewLoopOptions): Promise<ReviewLoopResult> {
  const conversation = [...messages];
  const executedToolCalls: ExecutedReviewToolCall[] = [];
  const usedToolCallIds = new Set<string>();
  let toolCallCount = 0;
  let generatedToolCallId = 0;

  for (let round = 1; round <= maxRounds; round += 1) {
    const request = {
      messages: [...conversation],
      round,
      maxRounds,
      remainingToolCalls: maxToolCalls - toolCallCount,
    };
    emitModelRequestEvent(onEvent, request);

    const response = await model.complete(request);
    const extractedToolCalls = extractToolCalls(response);
    const reservedToolCallIds = new Set(
      extractedToolCalls
        .map((toolCall) => toolCall.id)
        .filter((id) => id !== undefined),
    );

    const toolCalls = extractedToolCalls.map((toolCall) => {
      if (toolCall.id !== undefined && !usedToolCallIds.has(toolCall.id)) {
        usedToolCallIds.add(toolCall.id);

        return toolCall;
      }

      let id: string;

      do {
        generatedToolCallId += 1;
        id = `json_tool_call_${String(generatedToolCallId)}`;
      } while (usedToolCallIds.has(id) || reservedToolCallIds.has(id));

      usedToolCallIds.add(id);

      return {
        ...toolCall,
        id,
      };
    });

    if (toolCalls.length === 0) {
      if (response.content === undefined) {
        throw new Error(
          "Model response did not include final content or tool calls",
        );
      }

      conversation.push({
        role: "assistant",
        content: response.content,
      });

      return requestFinalResponseWithoutTools({
        conversation,
        executedToolCalls,
        finalRound: getFinalResponseRound(round, maxRounds),
        maxRounds,
        model,
        ...(onEvent === undefined ? {} : { onEvent }),
        finalReportInstructions,
        reason:
          "The model stopped requesting tools. Return the final review JSON now using only the context already available.",
      });
    }

    if (toolCallCount + toolCalls.length > maxToolCalls) {
      if (response.content !== undefined) {
        conversation.push({
          role: "assistant",
          content: response.content,
        });
      }

      return requestFinalResponseWithoutTools({
        conversation,
        executedToolCalls,
        finalRound: getFinalResponseRound(round, maxRounds),
        maxRounds,
        model,
        ...(onEvent === undefined ? {} : { onEvent }),
        finalReportInstructions,
        reason: [
          "The model requested more tools than the configured tool call limit allows.",
          `Requested tool calls would total ${String(toolCallCount + toolCalls.length)} but the limit is ${String(maxToolCalls)}.`,
          "Return the final review JSON now using only the context already available.",
        ].join("\n"),
      });
    }

    conversation.push({
      role: "assistant",
      content: response.content ?? "",
      toolCalls,
    });

    for (const toolCall of toolCalls) {
      onEvent?.({
        type: "tool_call",
        arguments: summarizeForLog(toolCall.arguments),
        round,
        name: toolCall.name,
      });
      const result = await executeReviewToolCall(toolRunner, toolCall);
      onEvent?.({
        type: "tool_result",
        failed: isToolErrorResult(result),
        name: toolCall.name,
        resultBytes: getJsonByteLength(result),
        round,
      });
      executedToolCalls.push({
        ...toolCall,
        result,
      });
      conversation.push({
        role: "tool",
        ...(toolCall.id === undefined ? {} : { toolCallId: toolCall.id }),
        name: toolCall.name,
        content: JSON.stringify(result),
      });
    }

    toolCallCount += toolCalls.length;
  }

  return requestFinalResponseWithoutTools({
    conversation,
    executedToolCalls,
    finalRound: maxRounds,
    maxRounds,
    model,
    ...(onEvent === undefined ? {} : { onEvent }),
    finalReportInstructions,
    reason:
      "Tool round limit reached. Return the final review JSON now using only the context already available.",
  });
}

async function requestFinalResponseWithoutTools({
  conversation,
  executedToolCalls,
  finalReportInstructions,
  finalRound,
  maxRounds,
  model,
  onEvent,
  reason,
}: {
  conversation: ReviewModelMessage[];
  executedToolCalls: ExecutedReviewToolCall[];
  finalReportInstructions?: string[];
  finalRound: number;
  maxRounds: number;
  model: ReviewModel;
  onEvent?: (event: ReviewLoopEvent) => void;
  reason: string;
}): Promise<ReviewLoopResult> {
  onEvent?.({
    type: "final_report_request",
    round: finalRound,
    maxRounds,
  });
  const request: ReviewModelRequest = {
    messages: [
      ...conversation,
      {
        role: "user",
        content: [
          reason,
          ...(finalReportInstructions ?? []),
          "Return exactly one valid JSON object.",
          "Do not include markdown fences, headings, bullet lists, or code blocks.",
          "Do not write any prose before or after the JSON object.",
          'The first non-whitespace character must be "{" and the last non-whitespace character must be "}".',
          'Use this exact shape: {"summary":"string","findings":[{"path":"string","side":"new|old","startLine":number,"endLine":number,"code":"string","severity":"low|medium|high","title":"string","body":"string","suggestion":"string","replacementCode":"string"}]}',
          "Do not return duplicate findings. If multiple observations describe the same issue on the same path, side, startLine/endLine, code, and severity, merge them into one finding.",
          "Put only actionable issues that can be anchored to a changed, deleted, added, or context line in the merge request diff in findings.",
          ...reviewFindingEvidenceInstructions,
          "Use read_diff evidence already gathered during review to choose path, side, startLine, endLine, and code.",
          "Use read_file context only when explaining the issue; do not anchor findings to read_file line numbers unless those exact lines also appear in read_diff output.",
          "Do not use approximate, nearby, or repository-file line numbers unless those exact lines appear in the MR diff hunk.",
          "Use replacementCode only for safe single-line or small-range replacements where the selected diff range is clear and the replacement is complete.",
          "Put only the exact replacement code in replacementCode, without markdown fences or explanatory text.",
          "For complex, ambiguous, architectural, or multi-step fixes, leave replacementCode empty and explain the fix in suggestion.",
          "Do not include repository-wide, architectural, or unrelated observations in findings unless they can be anchored to a specific diff line. Mention non-anchorable context only in summary without claiming it is an actionable finding.",
          "Every actionable issue mentioned in summary must also appear in findings.",
          "Do not claim that actionable issues were identified when findings is empty.",
          "Do not request more tools.",
        ].join("\n"),
      },
    ],
    round: finalRound,
    maxRounds,
    remainingToolCalls: 0,
    responseFormat: "review_report",
  };
  emitModelRequestEvent(onEvent, request);

  const response = await model.complete(request);

  if (response.content === undefined) {
    throw new Error(
      `Review loop exceeded maxRounds: ${String(maxRounds)} and the model did not produce final content`,
    );
  }

  return {
    finalMessage: response.content,
    rounds: finalRound,
    toolCalls: executedToolCalls,
  };
}

async function executeReviewToolCall(
  toolRunner: ToolRunner,
  toolCall: ReviewToolCall,
): Promise<unknown> {
  try {
    return await toolRunner.execute(toToolRunnerCall(toolCall));
  } catch (error) {
    return {
      error: `Tool call failed: ${formatErrorMessage(error)}`,
    };
  }
}

function getFinalResponseRound(round: number, maxRounds: number): number {
  return Math.min(round + 1, maxRounds);
}

function emitModelRequestEvent(
  onEvent: ((event: ReviewLoopEvent) => void) | undefined,
  request: ReviewModelRequest,
): void {
  onEvent?.({
    type: "model_request",
    round: request.round,
    maxRounds: request.maxRounds,
    remainingToolCalls: request.remainingToolCalls,
    ...(request.responseFormat === undefined
      ? {}
      : { responseFormat: request.responseFormat }),
  });
}

function extractToolCalls(response: ReviewModelResponse): ReviewToolCall[] {
  if (response.toolCalls !== undefined && response.toolCalls.length > 0) {
    return z.array(reviewToolCallSchema).parse(response.toolCalls);
  }

  if (response.content === undefined) {
    return [];
  }

  const parsedContent = parseJson(response.content);

  if (parsedContent === undefined) {
    return [];
  }

  return readJsonToolCallEnvelope(parsedContent);
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
}

function readJsonToolCallEnvelope(parsedContent: unknown): ReviewToolCall[] {
  if (
    typeof parsedContent !== "object" ||
    parsedContent === null ||
    Array.isArray(parsedContent)
  ) {
    return [];
  }

  const content = parsedContent as Record<string, unknown>;
  const keys = Object.keys(content);
  const toolCallKeys = keys.filter(
    (key) => key === "tool_calls" || key === "toolCalls",
  );

  if (toolCallKeys.length === 0) {
    return [];
  }

  if (keys.some((key) => !jsonToolCallEnvelopeKeys.has(key))) {
    return [];
  }

  const envelope = jsonToolCallEnvelopeSchema.parse(content);

  return envelope.tool_calls ?? envelope.toolCalls ?? [];
}

const jsonToolCallEnvelopeKeys = new Set([
  "tool_calls",
  "toolCalls",
  "message",
  "refusal",
  "finish_reason",
  "finishReason",
]);

function toToolRunnerCall(toolCall: ReviewToolCall): ToolCall {
  return {
    name: toolCall.name,
    arguments: toolCall.arguments,
  };
}

function summarizeForLog(value: unknown): string {
  const redacted = redactForLog(value);

  return truncate(stringifyLogValue(redacted), 500);
}

function redactForLog(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") {
    return typeof value === "string" ? truncate(value, 120) : value;
  }

  if (depth >= 3) {
    return Array.isArray(value) ? "[array]" : "[object]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => redactForLog(item, depth + 1));
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(value)) {
    redacted[key] = isSensitiveLogKey(key)
      ? "[redacted]"
      : redactForLog(child, depth + 1);
  }

  return redacted;
}

function isSensitiveLogKey(key: string): boolean {
  const normalized = key.replace(/[-_\s]/gu, "").toLowerCase();

  if (normalized === "key") {
    return true;
  }

  return [
    "accesstoken",
    "apikey",
    "authorization",
    "authorizationheader",
    "credential",
    "credentials",
    "idtoken",
    "password",
    "privatekey",
    "refreshtoken",
    "secret",
    "secretkey",
    "sshkey",
    "token",
  ].some((sensitiveKey) => normalized.endsWith(sensitiveKey));
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function getJsonByteLength(value: unknown): number {
  return Buffer.byteLength(stringifyLogValue(value), "utf8");
}

function isToolErrorResult(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const error = (value as { error?: unknown }).error;

  return typeof error === "string" && error.startsWith("Tool call failed:");
}
