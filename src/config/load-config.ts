import { access, readFile } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";

import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { ZodError } from "zod";

import { configSchema, type CodeReviewerConfig } from "./schema.js";
import { formatErrorMessage } from "../tools/format-error.js";

/** Options for locating and loading configuration. */
export type LoadConfigOptions = {
  cwd?: string;
  configPath?: string;
};

const defaultConfigFiles = [
  ".codereviewer.yml",
  ".codereviewer.yaml",
  ".codereviewer.json",
  ".codereviewer.jsonc",
];
const packageJsonConfigKey = "codereviewer";
const pyprojectTomlConfigPath = ["tool", "codereviewer"];
const pyprojectTomlConfigLabel = "[tool.codereviewer]";
const cargoTomlConfigPath = ["package", "metadata", "codereviewer"];
const cargoTomlConfigLabel = "[package.metadata.codereviewer]";

type ConfigSource = {
  path: string;
  config: unknown;
};

/**
 * Loads Code Reviewer configuration from an explicit config path, a default
 * `.codereviewer.*` file, host project metadata, or built-in defaults.
 */
export async function loadConfig(
  options: LoadConfigOptions = {},
): Promise<CodeReviewerConfig> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath
    ? resolveConfigPath(cwd, options.configPath)
    : await findDefaultConfig(cwd);

  const configSource =
    configPath === undefined
      ? await readHostProjectConfig(cwd)
      : {
          path: configPath,
          config: await readConfigFile(configPath),
        };
  const rawConfig = configSource?.config ?? {};

  try {
    return configSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof ZodError) {
      const issueSummary = error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
          return `${path}: ${issue.message}`;
        })
        .join("; ");
      throw new Error(
        `Invalid config ${configSource?.path ?? "<defaults>"}: ${issueSummary}`,
        {
          cause: error,
        },
      );
    }

    throw error;
  }
}

async function readHostProjectConfig(
  cwd: string,
): Promise<ConfigSource | undefined> {
  return (
    (await readPackageJsonConfig(cwd)) ??
    (await readHostTomlConfig(
      cwd,
      "pyproject.toml",
      pyprojectTomlConfigPath,
      pyprojectTomlConfigLabel,
    )) ??
    (await readHostTomlConfig(
      cwd,
      "Cargo.toml",
      cargoTomlConfigPath,
      cargoTomlConfigLabel,
    ))
  );
}

async function readPackageJsonConfig(
  cwd: string,
): Promise<ConfigSource | undefined> {
  const packageJsonPath = join(cwd, "package.json");
  let contents: string;

  try {
    contents = await readFile(packageJsonPath, "utf8");
  } catch {
    return undefined;
  }

  const packageJson = parseJsonConfig(packageJsonPath, contents);

  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    Array.isArray(packageJson)
  ) {
    throw new Error(`Expected ${packageJsonPath} to contain a JSON object`);
  }

  const config = (packageJson as Record<string, unknown>)[packageJsonConfigKey];

  return config === undefined
    ? undefined
    : {
        path: `${packageJsonPath}#${packageJsonConfigKey}`,
        config,
      };
}

async function readHostTomlConfig(
  cwd: string,
  fileName: string,
  configPathSegments: string[],
  configLabel: string,
): Promise<ConfigSource | undefined> {
  const tomlPath = join(cwd, fileName);
  let contents: string;

  try {
    contents = await readFile(tomlPath, "utf8");
  } catch {
    return undefined;
  }

  const tomlConfig = parseTomlConfig(tomlPath, contents);
  const config = readPath(tomlConfig, configPathSegments);

  return config === undefined
    ? undefined
    : {
        path: `${tomlPath}#${configLabel}`,
        config,
      };
}

function resolveConfigPath(cwd: string, configPath: string): string {
  return isAbsolute(configPath) ? configPath : resolve(cwd, configPath);
}

async function findDefaultConfig(cwd: string): Promise<string | undefined> {
  for (const fileName of defaultConfigFiles) {
    const configPath = join(cwd, fileName);

    try {
      await access(configPath);
      return configPath;
    } catch {
      // Try the next default config file name.
    }
  }

  return undefined;
}

async function readConfigFile(configPath: string): Promise<unknown> {
  let contents: string;

  try {
    contents = await readFile(configPath, "utf8");
  } catch (error) {
    throw new Error(
      `Cannot read config ${configPath}: ${formatErrorMessage(error)}`,
      {
        cause: error,
      },
    );
  }

  return parseConfigContents(configPath, contents);
}

function parseConfigContents(configPath: string, contents: string): unknown {
  const extension = extname(configPath).toLowerCase();

  switch (extension) {
    case ".json":
      return parseJsonConfig(configPath, contents);
    case ".jsonc":
      return parseJsoncConfig(configPath, contents);
    case ".toml":
      return parseTomlConfig(configPath, contents);
    case ".yaml":
    case ".yml":
      return parseYamlConfig(configPath, contents);
    default:
      throw new Error(
        `Unsupported config file extension ${formatConfigExtension(extension)} for config ${configPath}`,
      );
  }
}

function formatConfigExtension(extension: string): string {
  return extension === "" ? "<none>" : extension;
}

function parseJsonConfig(configPath: string, contents: string): unknown {
  try {
    return JSON.parse(contents) as unknown;
  } catch (error) {
    throw new Error(
      `Cannot parse config ${configPath}: ${formatErrorMessage(error)}`,
      {
        cause: error,
      },
    );
  }
}

function parseJsoncConfig(configPath: string, contents: string): unknown {
  try {
    const normalizedContents = removeJsonTrailingCommas(
      stripJsonComments(contents),
    );

    if (normalizedContents.trim().length === 0) {
      return {};
    }

    return JSON.parse(normalizedContents) as unknown;
  } catch (error) {
    throw new Error(
      `Cannot parse config ${configPath}: ${formatErrorMessage(error)}`,
      { cause: error },
    );
  }
}

function stripJsonComments(contents: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < contents.length; index += 1) {
    const char = contents[index];
    const nextChar = contents[index + 1];

    if (char === undefined) {
      continue;
    }

    if (inString) {
      result += char;

      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    if (char === "/" && nextChar === "/") {
      index += 2;
      while (index < contents.length && !isLineBreak(contents[index])) {
        index += 1;
      }

      if (index < contents.length) {
        result += contents[index] ?? "";
      }
      continue;
    }

    if (char === "/" && nextChar === "*") {
      index += 2;
      result += " ";
      while (
        index < contents.length &&
        !(contents[index] === "*" && contents[index + 1] === "/")
      ) {
        result += isLineBreak(contents[index]) ? (contents[index] ?? "") : " ";
        index += 1;
      }

      if (index >= contents.length) {
        throw new Error("Unterminated JSONC block comment");
      }

      index += 1;
      continue;
    }

    result += char;
  }

  return result;
}

function removeJsonTrailingCommas(contents: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < contents.length; index += 1) {
    const char = contents[index];

    if (char === undefined) {
      continue;
    }

    if (inString) {
      result += char;

      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    if (char === ",") {
      const nextSignificantChar = findNextNonWhitespaceChar(contents, index + 1);

      if (nextSignificantChar === "}" || nextSignificantChar === "]") {
        continue;
      }
    }

    result += char;
  }

  return result;
}

function findNextNonWhitespaceChar(
  contents: string,
  startIndex: number,
): string | undefined {
  for (let index = startIndex; index < contents.length; index += 1) {
    const char = contents[index];

    if (char !== undefined && !/\s/u.test(char)) {
      return char;
    }
  }

  return undefined;
}

function isLineBreak(char: string | undefined): boolean {
  return char === "\n" || char === "\r";
}

function parseTomlConfig(configPath: string, contents: string): unknown {
  try {
    return parseToml(contents);
  } catch (error) {
    throw new Error(
      `Cannot parse config ${configPath}: ${formatErrorMessage(error)}`,
      {
        cause: error,
      },
    );
  }
}

function parseYamlConfig(configPath: string, contents: string): unknown {
  try {
    return parseYaml(contents) ?? {};
  } catch (error) {
    throw new Error(
      `Cannot parse config ${configPath}: ${formatErrorMessage(error)}`,
      {
        cause: error,
      },
    );
  }
}

function readPath(source: unknown, pathSegments: string[]): unknown {
  let current = source;

  for (const segment of pathSegments) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current)
    ) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}
