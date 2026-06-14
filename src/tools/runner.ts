import type { GitLabMergeRequestContext } from "../gitlab/mr-context.js";
import { builtInTools } from "./builtin/index.js";
import type {
  BuiltInToolName,
  ToolImplementation,
  ToolLimits,
  ToolPermissions,
  ToolRuntime,
  ToolRunner,
} from "./types.js";

/** Options for creating a bounded tool runner. */
export type CreateToolRunnerOptions = {
  cwd: string;
  context: GitLabMergeRequestContext;
  enabledTools?: string[];
  gitlab?: ToolRuntime["gitlab"];
  limits?: Partial<ToolLimits>;
  permissions?: Partial<ToolPermissions>;
  tools?: Record<string, ToolImplementation>;
};

const defaultLimits: ToolLimits = {
  maxToolCalls: 120,
  maxBytesPerToolResult: 1000000,
  maxTotalContextBytes: 8000000,
  timeoutMs: 60000,
};

const defaultEnabledTools: BuiltInToolName[] = [
  "read_diff",
  "read_file",
  "repo_search",
  "read_gitlab_mr",
  "read_gitlab_issue",
  "list_gitlab_issues",
  "list_gitlab_mrs",
  "read_gitlab_mr_discussions",
];

const defaultPermissions: ToolPermissions = {
  readRepo: true,
  readGitLab: true,
  shell: false,
  network: false,
  write: false,
};

const requiredToolPermissions: Record<BuiltInToolName, keyof ToolPermissions> =
  {
    read_diff: "readRepo",
    read_file: "readRepo",
    repo_search: "readRepo",
    read_gitlab_mr: "readGitLab",
    read_gitlab_issue: "readGitLab",
    list_gitlab_issues: "readGitLab",
    list_gitlab_mrs: "readGitLab",
    read_gitlab_mr_discussions: "readGitLab",
  };

export function isToolPermitted(
  toolName: string,
  permissions: ToolPermissions,
): boolean {
  const requiredPermission = getRequiredToolPermission(toolName);

  return requiredPermission === undefined || permissions[requiredPermission];
}

/** Creates a tool runner with enabled-tool, timeout, and context-size limits. */
export function createToolRunner({
  cwd,
  context,
  enabledTools = defaultEnabledTools,
  gitlab,
  limits,
  permissions,
  tools,
}: CreateToolRunnerOptions): ToolRunner {
  const registry: Record<string, ToolImplementation> = {
    ...builtInTools,
    ...(tools ?? {}),
  };
  const effectiveLimits = {
    ...defaultLimits,
    ...(limits ?? {}),
  };
  const effectivePermissions = {
    ...defaultPermissions,
    ...(permissions ?? {}),
  };
  let callCount = 0;
  let totalContextBytes = 0;

  return {
    async execute(call) {
      const tool = registry[call.name];

      if (tool === undefined) {
        throw new Error(`Unknown tool: ${call.name}`);
      }

      if (!enabledTools.includes(call.name)) {
        throw new Error(`Tool is not enabled: ${call.name}`);
      }

      assertToolPermission(call.name, effectivePermissions);

      if (callCount >= effectiveLimits.maxToolCalls) {
        throw new Error(
          `Tool call limit exceeded: ${String(effectiveLimits.maxToolCalls)}`,
        );
      }

      callCount += 1;

      const parsedArgs = tool.inputSchema.parse(call.arguments);
      const result = await withTimeout(
        tool.execute(parsedArgs, {
          cwd,
          context,
          limits: effectiveLimits,
          ...(gitlab === undefined ? {} : { gitlab }),
        }),
        effectiveLimits.timeoutMs,
        call.name,
      );
      const resultBytes = Buffer.byteLength(JSON.stringify(result), "utf8");

      if (resultBytes > effectiveLimits.maxBytesPerToolResult) {
        throw new Error(
          `Tool result exceeds maxBytesPerToolResult: ${String(resultBytes)} > ${String(effectiveLimits.maxBytesPerToolResult)}`,
        );
      }

      if (
        totalContextBytes + resultBytes >
        effectiveLimits.maxTotalContextBytes
      ) {
        throw new Error(
          `Tool results exceed maxTotalContextBytes: ${String(totalContextBytes + resultBytes)} > ${String(effectiveLimits.maxTotalContextBytes)}`,
        );
      }

      totalContextBytes += resultBytes;

      return result;
    },
  };
}

function assertToolPermission(
  toolName: string,
  permissions: ToolPermissions,
): void {
  const requiredPermission = getRequiredToolPermission(toolName);

  if (requiredPermission !== undefined && !permissions[requiredPermission]) {
    throw new Error(
      `Tool permission denied: ${toolName} requires ${requiredPermission}`,
    );
  }
}

function getRequiredToolPermission(
  toolName: string,
): keyof ToolPermissions | undefined {
  return toolName in requiredToolPermissions
    ? requiredToolPermissions[toolName as BuiltInToolName]
    : undefined;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  toolName: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Tool timed out: ${toolName}`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export type {
  BuiltInToolName,
  ToolCall,
  ToolImplementation,
  ToolLimits,
  ToolPermissions,
  ToolRunner,
  ToolRuntime,
} from "./types.js";
