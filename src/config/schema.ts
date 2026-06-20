import { z } from "zod";

/** Built-in tool names accepted by configuration. */
export const toolNameSchema = z.enum([
  "read_diff",
  "read_file",
  "repo_search",
  "read_gitlab_mr",
  "read_gitlab_issue",
  "list_gitlab_issues",
  "list_gitlab_mrs",
  "read_gitlab_mr_discussions",
  "read_github_pr",
  "read_github_pr_comments",
]);

/** Runtime configuration schema for the CLI and library entry points. */
export const configSchema = z
  .object({
    provider: z.enum(["auto", "gitlab", "github"]).default("auto"),
    review: z
      .object({
        maxRounds: z.number().int().positive().default(12),
      })
      .strict()
      .default({
        maxRounds: 12,
      }),
    model: z
      .object({
        provider: z.literal("openai-compatible").default("openai-compatible"),
        baseUrl: z.url().optional(),
        apiKeyEnv: z.string().min(1).default("OPENAI_API_KEY"),
        model: z.string().min(1).optional(),
        temperature: z.number().min(0).max(2).optional(),
        maxOutputTokens: z.number().int().positive().optional(),
        timeoutMs: z.number().int().positive().default(300000),
        responseFormat: z
          .enum(["auto", "json_schema", "json_object", "off"])
          .default("auto"),
      })
      .strict()
      .default({
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
        timeoutMs: 300000,
        responseFormat: "auto",
      }),
    gitlab: z
      .object({
        tokenEnv: z.string().min(1).default("GITLAB_TOKEN"),
        publish: z.enum(["dry-run", "summary", "inline"]).default("dry-run"),
        failOnSeverity: z
          .enum(["none", "low", "medium", "high"])
          .default("none"),
      })
      .strict()
      .default({
        tokenEnv: "GITLAB_TOKEN",
        publish: "dry-run",
        failOnSeverity: "none",
      }),
    github: z
      .object({
        tokenEnv: z.string().min(1).default("GITHUB_TOKEN"),
        publish: z.enum(["dry-run", "summary", "inline"]).default("dry-run"),
        failOnSeverity: z
          .enum(["none", "low", "medium", "high"])
          .default("none"),
      })
      .strict()
      .default({
        tokenEnv: "GITHUB_TOKEN",
        publish: "dry-run",
        failOnSeverity: "none",
      }),
    prompts: z
      .object({
        system: z.string().min(1).optional(),
        review: z.string().min(1).optional(),
        extraRules: z.array(z.string().min(1)).default([]),
      })
      .strict()
      .default({
        extraRules: [],
      }),
    templates: z
      .object({
        summary: z.string().min(1).optional(),
        inline: z.string().min(1).optional(),
      })
      .strict()
      .default({}),
    tools: z
      .object({
        enabled: z
          .array(toolNameSchema)
          .default([
            "read_diff",
            "read_file",
            "repo_search",
            "read_gitlab_mr",
            "read_gitlab_issue",
            "list_gitlab_issues",
            "list_gitlab_mrs",
            "read_gitlab_mr_discussions",
            "read_github_pr",
            "read_github_pr_comments",
          ]),
        limits: z
          .object({
            maxToolCalls: z.number().int().positive().default(120),
            maxBytesPerToolResult: z.number().int().positive().default(1000000),
            maxTotalContextBytes: z.number().int().positive().default(8000000),
            timeoutMs: z.number().int().positive().default(60000),
          })
          .strict()
          .default({
            maxToolCalls: 120,
            maxBytesPerToolResult: 1000000,
            maxTotalContextBytes: 8000000,
            timeoutMs: 60000,
          }),
        permissions: z
          .object({
            readRepo: z.boolean().default(true),
            readPlatform: z.boolean().default(true),
            readGitLab: z.boolean().default(true),
            shell: z.boolean().default(false),
            network: z.boolean().default(false),
            write: z.boolean().default(false),
          })
          .strict()
          .default({
            readRepo: true,
            readPlatform: true,
            readGitLab: true,
            shell: false,
            network: false,
            write: false,
          }),
      })
      .strict()
      .default({
        enabled: [
          "read_diff",
          "read_file",
          "repo_search",
          "read_gitlab_mr",
          "read_gitlab_issue",
          "list_gitlab_issues",
          "list_gitlab_mrs",
          "read_gitlab_mr_discussions",
          "read_github_pr",
          "read_github_pr_comments",
        ],
        limits: {
          maxToolCalls: 120,
          maxBytesPerToolResult: 1000000,
          maxTotalContextBytes: 8000000,
          timeoutMs: 60000,
        },
        permissions: {
          readRepo: true,
          readPlatform: true,
          readGitLab: true,
          shell: false,
          network: false,
          write: false,
        },
      }),
  })
  .strict();

/** Fully resolved Code Reviewer configuration after defaults are applied. */
export type CodeReviewerConfig = z.infer<typeof configSchema>;
