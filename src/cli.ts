#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Command } from "commander";

import { loadConfig } from "./config/load-config.js";
import type { GitHubPullRequestClient } from "./github/client.js";
import type { GitHubPullRequestCommentsClient } from "./github/pull-request-comments.js";
import type { GitLabMergeRequestClient } from "./gitlab/mr-context.js";
import { createReadableLogger } from "./logger.js";
import { readPackageInfo } from "./package-info.js";
import type { ReviewModel } from "./review/loop.js";
import { runReviewCommand } from "./review/run-review-command.js";

/** Runtime overrides used by tests or custom embedders of the CLI. */
export type CliRuntime = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  githubClient?: GitHubPullRequestClient;
  githubCommentsClient?: GitHubPullRequestCommentsClient;
  gitlabClient?: GitLabMergeRequestClient;
  reviewModel?: ReviewModel;
  setExitCode?: (code: number) => void;
  stderr?: (text: string) => void;
  stdout?: (text: string) => void;
};

/** Creates the Code Reviewer command-line program. */
export function createCli(runtime: CliRuntime = {}): Command {
  const packageInfo = readPackageInfo();
  const cwd = runtime.cwd ?? process.cwd();
  const env = runtime.env ?? process.env;
  const stdout =
    runtime.stdout ??
    ((text: string) => {
      console.log(text);
    });
  const defaultStderr = (text: string) => {
    console.error(text);
  };
  const setExitCode =
    runtime.setExitCode ??
    ((code: number) => {
      process.exitCode = code;
    });

  const program = new Command()
    .name("codereviewer")
    .description("Run AI-assisted code review in pull request CI")
    .version(packageInfo.version);

  program
    .command("review")
    .description("Run an AI-assisted code review")
    .option("-c, --config <path>", "path to the Code Reviewer config file")
    .option("--dry-run", "load configuration without publishing comments")
    .option("--verbose", "write detailed review progress logs to stderr")
    .action(
      async (options: {
        config?: string;
        dryRun?: boolean;
        verbose?: boolean;
      }) => {
        const stderr =
          runtime.stderr ??
          (options.verbose === true || env.CI === "true"
            ? defaultStderr
            : undefined);
        const logger =
          options.verbose === true && stderr !== undefined
            ? createReadableLogger(stderr)
            : undefined;
        const config = await loadConfig(
          options.config === undefined
            ? { cwd }
            : {
                cwd,
                configPath: options.config,
              },
        );
        const result = await runReviewCommand({
          config,
          cwd,
          dryRun: options.dryRun === true,
          env,
          ...(runtime.githubClient === undefined
            ? {}
            : { githubClient: runtime.githubClient }),
          ...(runtime.githubCommentsClient === undefined
            ? {}
            : { githubCommentsClient: runtime.githubCommentsClient }),
          ...(runtime.gitlabClient === undefined
            ? {}
            : { gitlabClient: runtime.gitlabClient }),
          ...(runtime.reviewModel === undefined
            ? {}
            : { reviewModel: runtime.reviewModel }),
          ...(logger === undefined ? {} : { logger }),
          ...(stderr === undefined ? {} : { stderr }),
        });

        stdout(JSON.stringify(result.output, null, 2));

        if (result.shouldFail) {
          setExitCode(1);
        }
      },
    );

  return program;
}

/** Runs the CLI with the provided argv and optional test runtime overrides. */
export async function main(
  argv = process.argv,
  runtime: CliRuntime = {},
): Promise<void> {
  const program = createCli(runtime);

  await program.parseAsync(argv);
}

/** Returns whether a module should run as the CLI entrypoint. */
export function isCliEntrypoint(
  argvPath = process.argv[1],
  moduleUrl = import.meta.url,
): boolean {
  if (argvPath === undefined) {
    return false;
  }

  return (
    normalizeEntrypointPath(argvPath) ===
    normalizeEntrypointModuleUrl(moduleUrl)
  );
}

function normalizeEntrypointPath(filePath: string): string {
  try {
    return pathToFileURL(realpathSync(filePath)).href;
  } catch {
    return pathToFileURL(filePath).href;
  }
}

function normalizeEntrypointModuleUrl(moduleUrl: string): string {
  try {
    return pathToFileURL(realpathSync(fileURLToPath(moduleUrl))).href;
  } catch {
    return moduleUrl;
  }
}

if (isCliEntrypoint()) {
  await main();
}
