import OpenAI from "openai";
import { z, ZodError } from "zod";

import type { CodeReviewerConfig } from "../config/schema.js";
import type {
  ReviewModel,
  ReviewModelMessage,
  ReviewModelRequest,
  ReviewModelResponse,
  ReviewToolCall,
} from "../review/loop.js";
import { formatErrorMessage } from "../tools/format-error.js";

/** OpenAI-compatible function tool definition sent with chat completions. */
export type OpenAICompatibleToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

type OpenAICompatibleModelConfig = Omit<
  CodeReviewerConfig["model"],
  "responseFormat" | "timeoutMs"
> & {
  responseFormat?: CodeReviewerConfig["model"]["responseFormat"];
  timeoutMs?: CodeReviewerConfig["model"]["timeoutMs"];
};

/** Options for constructing an OpenAI-compatible review model adapter. */
export type CreateOpenAICompatibleReviewModelOptions = {
  config: OpenAICompatibleModelConfig;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  tools?: OpenAICompatibleToolDefinition[];
};

type ResolvedOpenAICompatibleConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  organization?: string;
  project?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs: number;
  responseFormat: "auto" | "json_schema" | "json_object" | "off";
};

type EffectiveResponseFormat = "json_schema" | "json_object" | "off";

const defaultBaseUrl = "https://api.openai.com/v1";

const reviewFindingJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    path: {
      type: "string",
    },
    side: {
      type: "string",
      enum: ["new", "old"],
    },
    startLine: {
      type: "integer",
    },
    endLine: {
      type: "integer",
    },
    code: {
      type: "string",
    },
    severity: {
      type: "string",
      enum: ["low", "medium", "high"],
    },
    title: {
      type: "string",
    },
    body: {
      type: "string",
    },
    suggestion: {
      type: "string",
    },
    replacementCode: {
      type: "string",
    },
  },
  required: [
    "path",
    "side",
    "startLine",
    "endLine",
    "code",
    "severity",
    "title",
    "body",
    "suggestion",
    "replacementCode",
  ],
} as const;

const reviewReportJsonSchemaResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "code_reviewer_report",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: {
          type: "string",
        },
        findings: {
          type: "array",
          items: reviewFindingJsonSchema,
        },
      },
      required: ["summary", "findings"],
    },
  },
} as const;

class OpenAIChatCompletionRequestError extends Error {
  readonly #rawCause: unknown;
  readonly retryWithVersionedBaseUrl: boolean;
  readonly status?: number;
  readonly statusText?: string;

  constructor({
    cause,
    retryWithVersionedBaseUrl = false,
    status,
    statusText,
  }: {
    cause: unknown;
    retryWithVersionedBaseUrl?: boolean;
    status?: number;
    statusText?: string;
  }) {
    super("OpenAI-compatible chat completion request failed", { cause });
    this.name = "OpenAIChatCompletionRequestError";
    this.#rawCause = cause;
    this.retryWithVersionedBaseUrl = retryWithVersionedBaseUrl;

    if (status !== undefined) {
      this.status = status;
    }

    if (statusText !== undefined) {
      this.statusText = statusText;
    }
  }

  get rawCause(): unknown {
    return this.#rawCause;
  }
}

const chatCompletionResponseSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z.string().nullable().optional(),
                tool_calls: z
                  .array(
                    z
                      .object({
                        id: z.string().min(1),
                        type: z.literal("function"),
                        function: z
                          .object({
                            name: z.string().min(1),
                            arguments: z.string().default("{}"),
                          })
                          .loose(),
                      })
                      .loose(),
                  )
                  .optional(),
              })
              .loose(),
          })
          .loose(),
      )
      .min(1),
  })
  .loose();

const emptyChoicesResponseMaxRetries = 2;

type ParsedChatCompletionResponse = z.infer<
  typeof chatCompletionResponseSchema
>;
type ParsedChatCompletionMessage =
  ParsedChatCompletionResponse["choices"][number]["message"];
type ParsedChatCompletionToolCall = NonNullable<
  ParsedChatCompletionMessage["tool_calls"]
>[number];

type OpenAIChatCompletionClient = {
  createChatCompletion: (
    requestBody: Record<string, unknown>,
  ) => Promise<unknown>;
};

/** Creates a review model backed by an OpenAI-compatible chat completions API. */
export function createOpenAICompatibleReviewModel({
  config,
  env = process.env,
  fetch: fetchFn = globalThis.fetch,
  tools = [],
}: CreateOpenAICompatibleReviewModelOptions): ReviewModel {
  const resolved = resolveConfig(config, env);
  const clientCache = new Map<string, OpenAIChatCompletionClient>();
  let autoResponseFormat: EffectiveResponseFormat | undefined;

  function getClient(baseUrl: string): OpenAIChatCompletionClient {
    const cached = clientCache.get(baseUrl);

    if (cached !== undefined) {
      return cached;
    }

    const client = createOpenAIChatCompletionClient({
      baseUrl,
      config: resolved,
      fetch: fetchFn,
    });
    clientCache.set(baseUrl, client);
    return client;
  }

  return {
    async complete(request) {
      let responseFormat = resolveEffectiveResponseFormat({
        autoResponseFormat,
        config: resolved,
      });
      let emptyChoicesResponseRetries = 0;

      for (;;) {
        const requestBody = createRequestBody(
          request,
          resolved,
          tools,
          responseFormat,
        );
        let completion: unknown;

        try {
          completion = await requestChatCompletionWithVersionedBaseUrlFallback({
            baseUrl: resolved.baseUrl,
            getClient,
            requestBody,
          });
        } catch (error) {
          const fallbackResponseFormat = getAutoResponseFormatFallback({
            config: resolved,
            error,
            request,
            responseFormat,
          });

          if (fallbackResponseFormat === undefined) {
            throw toModelRequestError(error);
          }

          autoResponseFormat = fallbackResponseFormat;
          responseFormat = fallbackResponseFormat;
          continue;
        }

        try {
          const parsedBody = parseChatCompletionResponse(completion);

          return toReviewModelResponse(parsedBody.choices[0]?.message);
        } catch (error) {
          if (
            isEmptyChoicesResponse(completion) &&
            emptyChoicesResponseRetries < emptyChoicesResponseMaxRetries
          ) {
            emptyChoicesResponseRetries += 1;
            continue;
          }

          throw error;
        }
      }
    },
  };
}

async function requestChatCompletionWithVersionedBaseUrlFallback({
  baseUrl,
  getClient,
  requestBody,
}: {
  baseUrl: string;
  getClient: (baseUrl: string) => OpenAIChatCompletionClient;
  requestBody: Record<string, unknown>;
}): Promise<unknown> {
  try {
    return await requestChatCompletion({
      client: getClient(baseUrl),
      requestBody,
    });
  } catch (error) {
    if (
      error instanceof OpenAIChatCompletionRequestError &&
      shouldRetryWithVersionedBaseUrl({
        baseUrl,
        error,
      })
    ) {
      return requestChatCompletion({
        client: getClient(`${baseUrl}/v1`),
        requestBody,
      });
    }

    throw error;
  }
}

async function requestChatCompletion({
  client,
  requestBody,
}: {
  client: OpenAIChatCompletionClient;
  requestBody: Record<string, unknown>;
}): Promise<unknown> {
  return client.createChatCompletion(requestBody);
}

function createOpenAIChatCompletionClient({
  baseUrl,
  config,
  fetch: fetchFn,
}: {
  baseUrl: string;
  config: ResolvedOpenAICompatibleConfig;
  fetch: typeof fetch;
}): OpenAIChatCompletionClient {
  const tracker = createTrackingFetch(fetchFn);
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: baseUrl,
    ...(config.organization === undefined
      ? {}
      : { organization: config.organization }),
    ...(config.project === undefined ? {} : { project: config.project }),
    fetch: tracker.fetch,
    maxRetries: 2,
    timeout: config.timeoutMs,
  });

  return {
    async createChatCompletion(requestBody) {
      tracker.reset();

      try {
        return await client.chat.completions.create(
          requestBody as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
        );
      } catch (error) {
        const status =
          readOpenAIErrorStatus(error) ?? tracker.lastResponse?.status;
        const statusText = tracker.lastResponse?.statusText;
        const bodyReadable = tracker.lastResponse?.bodyReadable ?? true;
        const retryWithVersionedBaseUrl =
          status === 404 &&
          bodyReadable &&
          shouldRetryOpenAI404(tracker.lastResponse?.body);

        throw new OpenAIChatCompletionRequestError({
          cause: error,
          retryWithVersionedBaseUrl,
          ...(status === undefined ? {} : { status }),
          ...(statusText === undefined ? {} : { statusText }),
        });
      }
    },
  };
}

function createTrackingFetch(fetchFn: typeof fetch): {
  fetch: typeof fetch;
  lastResponse?: {
    body?: unknown;
    bodyReadable: boolean;
    status: number;
    statusText: string;
  };
  reset: () => void;
} {
  const tracker: {
    fetch: typeof fetch;
    lastResponse?: {
      body?: unknown;
      bodyReadable: boolean;
      status: number;
      statusText: string;
    };
    reset: () => void;
  } = {
    fetch: async (input, init) => {
      const response = await fetchFn(input, init);

      if (!response.ok) {
        const bodyResult = await readResponseBody(response);

        tracker.lastResponse = {
          ...(bodyResult.ok && bodyResult.body !== undefined
            ? { body: bodyResult.body }
            : {}),
          bodyReadable: bodyResult.ok,
          status: response.status,
          statusText: response.statusText,
        };
      }

      return response;
    },
    reset: () => {
      delete tracker.lastResponse;
    },
  };

  return tracker;
}

async function readResponseBody(
  response: Response,
): Promise<{ body?: unknown; ok: true } | { ok: false }> {
  try {
    const text = await response.clone().text();

    if (text.trim().length === 0) {
      return {
        ok: true,
      };
    }

    try {
      return {
        body: JSON.parse(text) as unknown,
        ok: true,
      };
    } catch {
      return {
        body: text,
        ok: true,
      };
    }
  } catch {
    return {
      ok: false,
    };
  }
}

function readOpenAIErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }

  const status = error.status;

  return typeof status === "number" ? status : undefined;
}

function toModelRequestError(error: unknown): Error {
  if (
    error instanceof OpenAIChatCompletionRequestError &&
    error.status !== undefined
  ) {
    const statusText =
      error.statusText === undefined || error.statusText.trim().length === 0
        ? "Unknown"
        : error.statusText;

    return new Error(
      `Model request failed: ${String(error.status)} ${statusText}`,
      { cause: error },
    );
  }

  if (error instanceof OpenAIChatCompletionRequestError) {
    return new Error(
      `Model request failed: ${formatErrorMessage(error.rawCause)}`,
      {
        cause: error,
      },
    );
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(`Model request failed: ${String(error)}`);
}

function resolveConfig(
  config: OpenAICompatibleModelConfig,
  env: Record<string, string | undefined>,
): ResolvedOpenAICompatibleConfig {
  const apiKeyEnv = config.apiKeyEnv || "OPENAI_API_KEY";
  const apiKey = readEnv(env, apiKeyEnv);

  if (apiKey === undefined) {
    throw new Error(`Missing OpenAI-compatible API key: set ${apiKeyEnv}`);
  }

  const model = config.model ?? readEnv(env, "OPENAI_MODEL");

  if (model === undefined) {
    throw new Error(
      "Missing OpenAI-compatible model: set model.model or OPENAI_MODEL",
    );
  }

  const organization = readEnv(env, "OPENAI_ORG_ID");
  const project = readEnv(env, "OPENAI_PROJECT_ID");

  return {
    apiKey,
    baseUrl: normalizeBaseUrl(
      config.baseUrl ?? readEnv(env, "OPENAI_BASE_URL") ?? defaultBaseUrl,
    ),
    model,
    responseFormat: config.responseFormat ?? "auto",
    timeoutMs: config.timeoutMs ?? 300000,
    ...(organization === undefined ? {} : { organization }),
    ...(project === undefined ? {} : { project }),
    ...(config.temperature === undefined
      ? {}
      : { temperature: config.temperature }),
    ...(config.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: config.maxOutputTokens }),
  };
}

function createRequestBody(
  request: ReviewModelRequest,
  config: ResolvedOpenAICompatibleConfig,
  tools: OpenAICompatibleToolDefinition[],
  responseFormat: EffectiveResponseFormat,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages: request.messages.map(toChatCompletionMessage),
  };

  if (config.temperature !== undefined) {
    body.temperature = config.temperature;
  }

  if (config.maxOutputTokens !== undefined) {
    body.max_tokens = config.maxOutputTokens;
  }

  if (responseFormat !== "off" && shouldRequestStructuredResponse(request)) {
    body.response_format = createResponseFormat(responseFormat);
  }

  if (
    tools.length > 0 &&
    request.remainingToolCalls > 0 &&
    request.responseFormat !== "review_report"
  ) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  return body;
}

function shouldRequestStructuredResponse(request: ReviewModelRequest): boolean {
  return request.responseFormat === "review_report";
}

function resolveEffectiveResponseFormat({
  autoResponseFormat,
  config,
}: {
  autoResponseFormat: EffectiveResponseFormat | undefined;
  config: ResolvedOpenAICompatibleConfig;
}): EffectiveResponseFormat {
  if (config.responseFormat === "auto") {
    return autoResponseFormat ?? "json_schema";
  }

  return config.responseFormat;
}

function getAutoResponseFormatFallback({
  config,
  error,
  request,
  responseFormat,
}: {
  config: ResolvedOpenAICompatibleConfig;
  error: unknown;
  request: ReviewModelRequest;
  responseFormat: EffectiveResponseFormat;
}): EffectiveResponseFormat | undefined {
  if (
    config.responseFormat !== "auto" ||
    responseFormat === "off" ||
    !shouldRequestStructuredResponse(request) ||
    !isResponseFormatUnsupportedError(error, responseFormat)
  ) {
    return undefined;
  }

  return responseFormat === "json_schema" ? "json_object" : "off";
}

function isResponseFormatUnsupportedError(
  error: unknown,
  responseFormat: Exclude<EffectiveResponseFormat, "off">,
): boolean {
  if (!(error instanceof OpenAIChatCompletionRequestError)) {
    return false;
  }

  if (error.status !== 400 && error.status !== 422) {
    return false;
  }

  const message = formatErrorMessage(error.rawCause).toLowerCase();
  const mentionsKnownFormat =
    message.includes("json_schema") || message.includes("json_object");
  const mentionsCurrentFormat = message.includes(responseFormat);

  return (
    message.includes("response_format") &&
    (mentionsCurrentFormat || !mentionsKnownFormat) &&
    (message.includes("unsupported") ||
      message.includes("not support") ||
      message.includes("invalid"))
  );
}

function createResponseFormat(
  responseFormat: Exclude<EffectiveResponseFormat, "off">,
): Record<string, unknown> {
  if (responseFormat === "json_object") {
    return {
      type: "json_object",
    };
  }

  return reviewReportJsonSchemaResponseFormat;
}

function toChatCompletionMessage(
  message: ReviewModelMessage,
): Record<string, unknown> {
  if (message.role === "assistant") {
    const chatMessage: Record<string, unknown> = {
      role: "assistant",
      content:
        message.toolCalls === undefined || message.toolCalls.length === 0
          ? message.content
          : message.content || null,
    };

    if (message.toolCalls !== undefined && message.toolCalls.length > 0) {
      chatMessage.tool_calls = message.toolCalls.map(toOpenAIToolCall);
    }

    return chatMessage;
  }

  if (message.role === "tool") {
    if (message.toolCallId !== undefined) {
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }

    return {
      role: "user",
      content: `Tool result from ${message.name ?? "tool"}:\n${message.content}`,
    };
  }

  return {
    role: message.role,
    content: message.content,
  };
}

function toOpenAIToolCall(toolCall: ReviewToolCall): Record<string, unknown> {
  return {
    ...(toolCall.id === undefined ? {} : { id: toolCall.id }),
    type: "function",
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.arguments),
    },
  };
}

function parseChatCompletionResponse(
  rawBody: unknown,
): ParsedChatCompletionResponse {
  try {
    return chatCompletionResponseSchema.parse(rawBody);
  } catch (error) {
    if (error instanceof ZodError) {
      const issueSummary = error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
          return `${path}: ${issue.message}`;
        })
        .join("; ");
      throw new Error(`Invalid model response: ${issueSummary}`, {
        cause: error,
      });
    }

    throw error;
  }
}

function isEmptyChoicesResponse(rawBody: unknown): boolean {
  if (
    typeof rawBody !== "object" ||
    rawBody === null ||
    Array.isArray(rawBody)
  ) {
    return false;
  }

  const choices = (rawBody as Record<string, unknown>).choices;

  return Array.isArray(choices) && choices.length === 0;
}

function toReviewModelResponse(
  message: ParsedChatCompletionMessage | undefined,
): ReviewModelResponse {
  if (message === undefined) {
    throw new Error("Invalid model response: choices.0.message is required");
  }

  const toolCalls = message.tool_calls?.map(toReviewToolCall) ?? [];

  if (toolCalls.length > 0) {
    return {
      ...(message.content === undefined || message.content === null
        ? {}
        : { content: message.content }),
      toolCalls,
    };
  }

  if (message.content === undefined || message.content === null) {
    throw new Error(
      "Invalid model response: choices.0.message must include content or tool_calls",
    );
  }

  return {
    content: message.content,
  };
}

function toReviewToolCall(
  toolCall: ParsedChatCompletionToolCall,
): ReviewToolCall {
  return {
    id: toolCall.id,
    name: toolCall.function.name,
    arguments: parseToolArguments(
      toolCall.function.arguments,
      toolCall.function.name,
    ),
  };
}

function parseToolArguments(rawArguments: string, toolName: string): unknown {
  try {
    return JSON.parse(rawArguments) as unknown;
  } catch (error) {
    throw new Error(
      `Cannot parse tool arguments JSON for ${toolName}: ${formatErrorMessage(error)}`,
      {
        cause: error,
      },
    );
  }
}

function readEnv(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  const value = env[key]?.trim();

  return value === "" ? undefined : value;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  const withProtocol = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;

  return withProtocol.replace(/\/+$/, "");
}

function shouldRetryWithVersionedBaseUrl({
  baseUrl,
  error,
}: {
  baseUrl: string;
  error: OpenAIChatCompletionRequestError;
}): boolean {
  if (error.status !== 404) {
    return false;
  }

  try {
    const url = new URL(baseUrl);

    if (url.pathname.split("/").includes("v1")) {
      return false;
    }
  } catch {
    return false;
  }

  return error.retryWithVersionedBaseUrl;
}

function shouldRetryOpenAI404(responseBody: unknown): boolean {
  const details = readOpenAIErrorDetails(responseBody);

  if (details === undefined) {
    return true;
  }

  const code = details.code?.toLowerCase() ?? "";
  const message = details.message?.toLowerCase() ?? "";

  if (code.includes("model") || code.includes("deployment")) {
    return false;
  }

  if (
    message.includes("model") &&
    (message.includes("not found") || message.includes("does not exist"))
  ) {
    return false;
  }

  return (
    message.includes("invalid url") ||
    message.includes("not found") ||
    message.includes("no route") ||
    message.includes("cannot post")
  );
}

function readOpenAIErrorDetails(responseBody: unknown):
  | {
      code?: string;
      message?: string;
      type?: string;
    }
  | undefined {
  if (
    typeof responseBody !== "object" ||
    responseBody === null ||
    Array.isArray(responseBody)
  ) {
    return undefined;
  }

  const error = (responseBody as Record<string, unknown>).error;

  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return undefined;
  }

  const errorRecord = error as Record<string, unknown>;
  const code = errorRecord.code;
  const message = errorRecord.message;
  const type = errorRecord.type;
  const details = {
    ...(typeof code === "string" ? { code } : {}),
    ...(typeof message === "string" ? { message } : {}),
    ...(typeof type === "string" ? { type } : {}),
  };

  return Object.keys(details).length === 0 ? undefined : details;
}
