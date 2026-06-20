import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config/load-config.js";

describe("loadConfig", () => {
  it("uses defaults when no config file exists", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    const config = await loadConfig({ cwd });

    expect(config).toEqual({
      provider: "auto",
      review: {
        maxRounds: 12,
      },
      model: {
        provider: "openai-compatible",
        apiKeyEnv: "OPENAI_API_KEY",
        responseFormat: "auto",
        timeoutMs: 300000,
      },
      gitlab: {
        tokenEnv: "GITLAB_TOKEN",
        publish: "dry-run",
        failOnSeverity: "none",
      },
      github: {
        tokenEnv: "GITHUB_TOKEN",
        publish: "dry-run",
        failOnSeverity: "none",
      },
      prompts: {
        extraRules: [],
      },
      templates: {},
      tools: {
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
      },
    });
  });

  it("finds the default .codereviewer.yml in the working directory", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    await writeFile(
      join(cwd, ".codereviewer.yml"),
      ["gitlab:", "  tokenEnv: REVIEW_TOKEN", ""].join("\n"),
    );

    const config = await loadConfig({ cwd });

    expect(config.gitlab.tokenEnv).toBe("REVIEW_TOKEN");
  });

  it("loads explicit GitHub provider configuration", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));
    const configPath = join(cwd, ".codereviewer.yml");

    await writeFile(
      configPath,
      [
        "provider: github",
        "github:",
        "  tokenEnv: REVIEW_GITHUB_TOKEN",
        "  publish: inline",
        "  failOnSeverity: medium",
        "tools:",
        "  enabled:",
        "    - read_diff",
        "    - read_github_pr",
        "    - read_github_pr_comments",
        "",
      ].join("\n"),
    );

    const config = await loadConfig({ cwd, configPath });

    expect(config.provider).toBe("github");
    expect(config.github).toEqual({
      tokenEnv: "REVIEW_GITHUB_TOKEN",
      publish: "inline",
      failOnSeverity: "medium",
    });
    expect(config.tools.enabled).toEqual([
      "read_diff",
      "read_github_pr",
      "read_github_pr_comments",
    ]);
  });

  it("prefers .codereviewer.yml over .codereviewer.yaml", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    await writeFile(
      join(cwd, ".codereviewer.yml"),
      ["gitlab:", "  tokenEnv: YAML_SHORT_TOKEN", ""].join("\n"),
    );
    await writeFile(
      join(cwd, ".codereviewer.yaml"),
      ["gitlab:", "  tokenEnv: YAML_LONG_TOKEN", ""].join("\n"),
    );

    const config = await loadConfig({ cwd });

    expect(config.gitlab.tokenEnv).toBe("YAML_SHORT_TOKEN");
  });

  it("loads default configuration from .codereviewer.json", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    await writeFile(
      join(cwd, ".codereviewer.json"),
      JSON.stringify({
        gitlab: {
          tokenEnv: "JSON_TOKEN",
        },
      }),
    );

    const config = await loadConfig({ cwd });

    expect(config.gitlab.tokenEnv).toBe("JSON_TOKEN");
  });

  it("loads default configuration from .codereviewer.jsonc", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    await writeFile(
      join(cwd, ".codereviewer.jsonc"),
      [
        "{",
        "  // JSONC comments are allowed.",
        '  "gitlab": {',
        '    "tokenEnv": "JSONC_TOKEN",',
        "  },",
        "}",
        "",
      ].join("\n"),
    );

    const config = await loadConfig({ cwd });

    expect(config.gitlab.tokenEnv).toBe("JSONC_TOKEN");
  });

  it("keeps comment markers inside JSONC strings", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    await writeFile(
      join(cwd, ".codereviewer.jsonc"),
      [
        "{",
        '  "prompts": {',
        '    "extraRules": [',
        '      "Keep // and /* text */ inside strings intact",',
        "    ],",
        "  },",
        "}",
        "",
      ].join("\n"),
    );

    const config = await loadConfig({ cwd });

    expect(config.prompts.extraRules).toEqual([
      "Keep // and /* text */ inside strings intact",
    ]);
  });

  it("keeps YAML defaults ahead of JSON defaults", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    await writeFile(
      join(cwd, ".codereviewer.yaml"),
      ["gitlab:", "  tokenEnv: YAML_TOKEN", ""].join("\n"),
    );
    await writeFile(
      join(cwd, ".codereviewer.json"),
      JSON.stringify({
        gitlab: {
          tokenEnv: "JSON_TOKEN",
        },
      }),
    );

    const config = await loadConfig({ cwd });

    expect(config.gitlab.tokenEnv).toBe("YAML_TOKEN");
  });

  it("prefers .codereviewer.json over .codereviewer.jsonc", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    await writeFile(
      join(cwd, ".codereviewer.json"),
      JSON.stringify({
        gitlab: {
          tokenEnv: "JSON_TOKEN",
        },
      }),
    );
    await writeFile(
      join(cwd, ".codereviewer.jsonc"),
      [
        "{",
        '  "gitlab": {',
        '    "tokenEnv": "JSONC_TOKEN"',
        "  }",
        "}",
        "",
      ].join("\n"),
    );

    const config = await loadConfig({ cwd });

    expect(config.gitlab.tokenEnv).toBe("JSON_TOKEN");
  });

  it("loads default configuration from package.json", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify(
        {
          codereviewer: {
            gitlab: {
              tokenEnv: "PACKAGE_TOKEN",
              publish: "summary",
            },
            tools: {
              enabled: ["read_gitlab_mr"],
            },
          },
        },
        null,
        2,
      ),
    );

    const config = await loadConfig({ cwd });

    expect(config.gitlab).toEqual({
      tokenEnv: "PACKAGE_TOKEN",
      publish: "summary",
      failOnSeverity: "none",
    });
    expect(config.tools.enabled).toEqual(["read_gitlab_mr"]);
  });

  it("prefers dedicated config files over package.json configuration", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    await writeFile(
      join(cwd, ".codereviewer.yml"),
      ["gitlab:", "  tokenEnv: YAML_TOKEN", ""].join("\n"),
    );
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        codereviewer: {
          gitlab: {
            tokenEnv: "PACKAGE_TOKEN",
          },
        },
      }),
    );

    const config = await loadConfig({ cwd });

    expect(config.gitlab.tokenEnv).toBe("YAML_TOKEN");
  });

  it("loads default configuration from pyproject.toml", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    await writeFile(
      join(cwd, "pyproject.toml"),
      [
        "[tool.codereviewer.gitlab]",
        'tokenEnv = "PYPROJECT_TOKEN"',
        'publish = "summary"',
        "",
        "[tool.codereviewer.tools]",
        'enabled = ["read_gitlab_mr"]',
        "",
      ].join("\n"),
    );

    const config = await loadConfig({ cwd });

    expect(config.gitlab).toEqual({
      tokenEnv: "PYPROJECT_TOKEN",
      publish: "summary",
      failOnSeverity: "none",
    });
    expect(config.tools.enabled).toEqual(["read_gitlab_mr"]);
  });

  it("loads default configuration from Cargo.toml", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    await writeFile(
      join(cwd, "Cargo.toml"),
      [
        "[package]",
        'name = "example"',
        'version = "0.1.0"',
        "",
        "[package.metadata.codereviewer.gitlab]",
        'tokenEnv = "CARGO_TOKEN"',
        "",
      ].join("\n"),
    );

    const config = await loadConfig({ cwd });

    expect(config.gitlab.tokenEnv).toBe("CARGO_TOKEN");
  });

  it("prefers package.json over pyproject.toml and Cargo.toml", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        codereviewer: {
          gitlab: {
            tokenEnv: "PACKAGE_TOKEN",
          },
        },
      }),
    );
    await writeFile(
      join(cwd, "pyproject.toml"),
      ["[tool.codereviewer.gitlab]", 'tokenEnv = "PYPROJECT_TOKEN"', ""].join(
        "\n",
      ),
    );
    await writeFile(
      join(cwd, "Cargo.toml"),
      [
        "[package.metadata.codereviewer.gitlab]",
        'tokenEnv = "CARGO_TOKEN"',
        "",
      ].join("\n"),
    );

    const config = await loadConfig({ cwd });

    expect(config.gitlab.tokenEnv).toBe("PACKAGE_TOKEN");
  });

  it("prefers pyproject.toml over Cargo.toml", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    await writeFile(
      join(cwd, "pyproject.toml"),
      ["[tool.codereviewer.gitlab]", 'tokenEnv = "PYPROJECT_TOKEN"', ""].join(
        "\n",
      ),
    );
    await writeFile(
      join(cwd, "Cargo.toml"),
      [
        "[package.metadata.codereviewer.gitlab]",
        'tokenEnv = "CARGO_TOKEN"',
        "",
      ].join("\n"),
    );

    const config = await loadConfig({ cwd });

    expect(config.gitlab.tokenEnv).toBe("PYPROJECT_TOKEN");
  });

  it("resolves an explicit relative config path from the working directory", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    await writeFile(
      join(cwd, "review.yml"),
      ["tools:", "  enabled:", "    - read_gitlab_mr", ""].join("\n"),
    );

    const config = await loadConfig({ cwd, configPath: "review.yml" });

    expect(config.tools.enabled).toEqual(["read_gitlab_mr"]);
  });

  it("reports extensionless explicit config paths as unsupported", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    await writeFile(
      join(cwd, "review"),
      ["tools:", "  enabled:", "    - read_gitlab_mr", ""].join("\n"),
    );

    await expect(loadConfig({ cwd, configPath: "review" })).rejects.toThrow(
      /Unsupported config file extension <none> for config .*review/,
    );
  });

  it("loads an explicit JSONC config path", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    await writeFile(
      join(cwd, "review.jsonc"),
      [
        "{",
        '  "tools": {',
        "    // Keep only the GitLab MR reader.",
        '    "enabled": ["read_gitlab_mr"],',
        "  }",
        "}",
        "",
      ].join("\n"),
    );

    const config = await loadConfig({ cwd, configPath: "review.jsonc" });

    expect(config.tools.enabled).toEqual(["read_gitlab_mr"]);
  });

  it("loads an explicit TOML config path", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    await writeFile(
      join(cwd, "review.toml"),
      ["[tools]", 'enabled = ["read_gitlab_mr"]', ""].join("\n"),
    );

    const config = await loadConfig({ cwd, configPath: "review.toml" });

    expect(config.tools.enabled).toEqual(["read_gitlab_mr"]);
  });

  it("loads project configuration from a YAML file", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));
    const configPath = join(cwd, ".codereviewer.yml");

    await writeFile(
      configPath,
      [
        "model:",
        "  provider: openai-compatible",
        "  baseUrl: https://llm.example.test/v1",
        "  apiKeyEnv: LLM_API_KEY",
        "  model: qwen-coder",
        "  temperature: 0.2",
        "  timeoutMs: 120000",
        "review:",
        "  maxRounds: 4",
        "gitlab:",
        "  tokenEnv: GL_TOKEN",
        "  publish: summary",
        "prompts:",
        "  system: .codereviewer/prompts/system.md",
        "  review: .codereviewer/prompts/review.md",
        "  extraRules:",
        "    - Write comments in Chinese.",
        "templates:",
        "  summary: .codereviewer/templates/summary.md",
        "  inline: .codereviewer/templates/inline.md",
        "tools:",
        "  enabled:",
        "    - read_diff",
        "    - read_file",
        "  limits:",
        "    maxToolCalls: 12",
        "    timeoutMs: 3000",
        "",
      ].join("\n"),
    );

    const config = await loadConfig({ cwd, configPath });

    expect(config.review).toEqual({
      maxRounds: 4,
    });
    expect(config.model).toEqual({
      provider: "openai-compatible",
      baseUrl: "https://llm.example.test/v1",
      apiKeyEnv: "LLM_API_KEY",
      model: "qwen-coder",
      temperature: 0.2,
      responseFormat: "auto",
      timeoutMs: 120000,
    });
    expect(config.gitlab).toEqual({
      tokenEnv: "GL_TOKEN",
      publish: "summary",
      failOnSeverity: "none",
    });
    expect(config.prompts).toEqual({
      system: ".codereviewer/prompts/system.md",
      review: ".codereviewer/prompts/review.md",
      extraRules: ["Write comments in Chinese."],
    });
    expect(config.templates).toEqual({
      summary: ".codereviewer/templates/summary.md",
      inline: ".codereviewer/templates/inline.md",
    });
    expect(config.tools.enabled).toEqual(["read_diff", "read_file"]);
    expect(config.tools.limits).toEqual({
      maxToolCalls: 12,
      maxBytesPerToolResult: 1000000,
      maxTotalContextBytes: 8000000,
      timeoutMs: 3000,
    });
    expect(config.tools.permissions).toEqual({
      readRepo: true,
      readPlatform: true,
      readGitLab: true,
      shell: false,
      network: false,
      write: false,
    });
  });

  it("reports invalid configuration with the failing path", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));
    const configPath = join(cwd, ".codereviewer.yml");

    await writeFile(
      configPath,
      ["model:", "  provider: unsupported-provider", ""].join("\n"),
    );

    await expect(loadConfig({ cwd, configPath })).rejects.toThrow(
      /Invalid config .*model\.provider/,
    );
  });

  it("rejects unknown top-level configuration keys", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));
    const configPath = join(cwd, ".codereviewer.yml");

    await writeFile(configPath, ["unknown:", "  enabled: true", ""].join("\n"));

    await expect(loadConfig({ cwd, configPath })).rejects.toThrow(
      /Invalid config .*Unrecognized key: "unknown"/,
    );
  });

  it("rejects unknown nested configuration keys", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));
    const configPath = join(cwd, ".codereviewer.yml");

    await writeFile(
      configPath,
      ["gitlab:", "  publsih: inline", ""].join("\n"),
    );

    await expect(loadConfig({ cwd, configPath })).rejects.toThrow(
      /Invalid config .*gitlab.*Unrecognized key: "publsih"/,
    );
  });

  it("reports missing explicit config files clearly", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    await expect(
      loadConfig({ cwd, configPath: "missing.yml" }),
    ).rejects.toThrow(/Cannot read config .*missing\.yml/);
  });

  it("reports YAML parse errors clearly", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));
    const configPath = join(cwd, ".codereviewer.yml");

    await writeFile(configPath, ["model:", "  provider: [", ""].join("\n"));

    await expect(loadConfig({ cwd, configPath })).rejects.toThrow(
      /Cannot parse config .*\.codereviewer\.yml/,
    );
  });

  it("reports JSON parse errors clearly", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));
    const configPath = join(cwd, ".codereviewer.json");

    await writeFile(configPath, '{"model": {"provider": }');

    await expect(loadConfig({ cwd, configPath })).rejects.toThrow(
      /Cannot parse config .*\.codereviewer\.json/,
    );
  });

  it("reports JSONC parse errors clearly", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));
    const configPath = join(cwd, ".codereviewer.jsonc");

    await writeFile(configPath, '{"model": {"provider": }');

    await expect(loadConfig({ cwd, configPath })).rejects.toThrow(
      /Cannot parse config .*\.codereviewer\.jsonc/,
    );
  });

  it("preserves JSONC parse errors as the thrown error cause", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));
    const configPath = join(cwd, ".codereviewer.jsonc");

    await writeFile(configPath, '{"model": {"provider": }');

    try {
      await loadConfig({ cwd, configPath });
      expect.unreachable("Expected JSONC parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const cause = (error as Error).cause;

      expect(cause).toBeInstanceOf(SyntaxError);
    }
  });

  it("reports TOML parse errors clearly", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));
    const configPath = join(cwd, "review.toml");

    await writeFile(configPath, ["[tools", ""].join("\n"));

    await expect(loadConfig({ cwd, configPath })).rejects.toThrow(
      /Cannot parse config .*review\.toml/,
    );
  });

  it("reports unsupported explicit config file extensions clearly", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));
    const configPath = join(cwd, "review.yamll");

    await writeFile(
      configPath,
      ["tools:", "  enabled:", "    - read_gitlab_mr", ""].join("\n"),
    );

    await expect(loadConfig({ cwd, configPath })).rejects.toThrow(
      /Unsupported config file extension .*\.yamll/,
    );
  });

  it("reports invalid package.json configuration with the failing path", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        codereviewer: {
          tools: {
            enabled: ["shell_exec"],
          },
        },
      }),
    );

    await expect(loadConfig({ cwd })).rejects.toThrow(
      /Invalid config .*package\.json#codereviewer.*tools\.enabled\.0/,
    );
  });

  it("reports invalid pyproject.toml configuration with the failing path", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    await writeFile(
      join(cwd, "pyproject.toml"),
      ["[tool.codereviewer.tools]", 'enabled = ["shell_exec"]', ""].join("\n"),
    );

    await expect(loadConfig({ cwd })).rejects.toThrow(
      /Invalid config .*pyproject\.toml#\[tool\.codereviewer\].*tools\.enabled\.0/,
    );
  });

  it("reports invalid Cargo.toml configuration with the failing path", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));

    await writeFile(
      join(cwd, "Cargo.toml"),
      [
        "[package.metadata.codereviewer.tools]",
        'enabled = ["shell_exec"]',
        "",
      ].join("\n"),
    );

    await expect(loadConfig({ cwd })).rejects.toThrow(
      /Invalid config .*Cargo\.toml#\[package\.metadata\.codereviewer\].*tools\.enabled\.0/,
    );
  });

  it("reports invalid tool names with the failing path", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));
    const configPath = join(cwd, ".codereviewer.yml");

    await writeFile(
      configPath,
      ["tools:", "  enabled:", "    - shell_exec", ""].join("\n"),
    );

    await expect(loadConfig({ cwd, configPath })).rejects.toThrow(
      /Invalid config .*tools\.enabled\.0/,
    );
  });

  it("rejects tools that are documented for the roadmap but not implemented", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));
    const configPath = join(cwd, ".codereviewer.yml");

    await writeFile(
      configPath,
      ["tools:", "  enabled:", "    - read_ci_report", ""].join("\n"),
    );

    await expect(loadConfig({ cwd, configPath })).rejects.toThrow(
      /Invalid config .*tools\.enabled\.0/,
    );
  });

  it("reports invalid numeric limits with the failing path", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));
    const configPath = join(cwd, ".codereviewer.yml");

    await writeFile(
      configPath,
      ["tools:", "  limits:", "    maxToolCalls: 0", ""].join("\n"),
    );

    await expect(loadConfig({ cwd, configPath })).rejects.toThrow(
      /Invalid config .*tools\.limits\.maxToolCalls/,
    );
  });

  it("reports invalid review loop limits with the failing path", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codereviewer-config-"));
    const configPath = join(cwd, ".codereviewer.yml");

    await writeFile(configPath, ["review:", "  maxRounds: 0", ""].join("\n"));

    await expect(loadConfig({ cwd, configPath })).rejects.toThrow(
      /Invalid config .*review\.maxRounds/,
    );
  });
});
