# Configuration

Code Reviewer configuration can be stored in `.codereviewer.yml`,
`.codereviewer.yaml`, `.codereviewer.json`, `.codereviewer.jsonc`,
`package.json#codereviewer`, `pyproject.toml#[tool.codereviewer]`, or
`Cargo.toml#[package.metadata.codereviewer]`. Prefer `.codereviewer.yml` at
the repository root with a schema comment for editor support:

```yaml
# yaml-language-server: $schema=./.schemas/code-reviewer.schema.json
```

Every field is optional. Code Reviewer fills in defaults and rejects unknown fields.
Never store API keys, GitLab tokens, or other secrets in configuration files.

## Discovery Order

Code Reviewer uses the first matching configuration source and does not merge later
sources:

1. The explicit `--config <path>` value.
2. `.codereviewer.yml`.
3. `.codereviewer.yaml`.
4. `.codereviewer.json`.
5. `.codereviewer.jsonc`.
6. `package.json#codereviewer`.
7. `pyproject.toml#[tool.codereviewer]`.
8. `Cargo.toml#[package.metadata.codereviewer]`.
9. Built-in defaults.

## CLI Options

`codereviewer review` supports these common options:

- `--config <path>`: load configuration from a specific file.
- `--dry-run`: print review JSON without publishing GitLab comments.
- `--verbose`: write readable progress logs to stderr while keeping stdout as
  final JSON.

Verbose logs include lifecycle events, model rounds, tool call summaries, and
tool result sizes. They do not include full prompts, model responses, or raw
tool results.

## Fields

<!-- markdownlint-disable MD013 -->

### `review`

| Field              | Default | Description                                                  |
| ------------------ | ------- | ------------------------------------------------------------ |
| `review.maxRounds` | `12`    | Maximum model/tool loop rounds before requesting final JSON. |

### `model`

| Field                   | Default                                             | Description                                                                                                                                                                                                                                                                          |
| ----------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `model.provider`        | `openai-compatible`                                 | Model provider. Only OpenAI-compatible chat completions are supported today.                                                                                                                                                                                                         |
| `model.apiKeyEnv`       | `OPENAI_API_KEY`                                    | Environment variable that contains the model API key.                                                                                                                                                                                                                                |
| `model.model`           | `OPENAI_MODEL`                                      | Model name. If omitted, Code Reviewer reads `OPENAI_MODEL`.                                                                                                                                                                                                                          |
| `model.baseUrl`         | `OPENAI_BASE_URL`, then `https://api.openai.com/v1` | OpenAI-compatible base URL.                                                                                                                                                                                                                                                          |
| `model.temperature`     | unset                                               | Optional temperature value passed through to the model request.                                                                                                                                                                                                                      |
| `model.maxOutputTokens` | unset                                               | Optional maximum output token count passed through to the model request.                                                                                                                                                                                                             |
| `model.timeoutMs`       | `300000`                                            | Per-request model timeout in milliseconds.                                                                                                                                                                                                                                           |
| `model.responseFormat`  | `auto`                                              | Final report response format: `auto`, `json_schema`, `json_object`, or `off`. `auto` tries `json_schema`, falls back to `json_object`, then omits `response_format` when the provider rejects both structured response formats. Use `off` to always rely on prompt-only JSON output. |

### `gitlab`

| Field                   | Default        | Description                                                                            |
| ----------------------- | -------------- | -------------------------------------------------------------------------------------- |
| `gitlab.tokenEnv`       | `GITLAB_TOKEN` | Environment variable for the GitLab token. The default also falls back to `GL_TOKEN`.  |
| `gitlab.publish`        | `dry-run`      | Publish mode: `dry-run`, `summary`, or `inline`.                                       |
| `gitlab.failOnSeverity` | `none`         | Minimum finding severity that should fail the job: `none`, `low`, `medium`, or `high`. |

### `prompts`

| Field                | Default | Description                                                                |
| -------------------- | ------- | -------------------------------------------------------------------------- |
| `prompts.system`     | unset   | Repository-relative file appended to the built-in system prompt.           |
| `prompts.review`     | unset   | Repository-relative file appended to the built-in review prompt.           |
| `prompts.extraRules` | `[]`    | Additional project rules, such as language, style, or suggestion guidance. |

### `templates`

| Field               | Default       | Description                                                          |
| ------------------- | ------------- | -------------------------------------------------------------------- |
| `templates.summary` | auto-discover | Repository-relative Markdown template for GitLab summary notes.      |
| `templates.inline`  | auto-discover | Repository-relative Markdown template for GitLab inline discussions. |

Code Reviewer renders templates with Handlebars. It does not register custom helpers.
Unknown simple placeholders are preserved, and known empty values render as
empty strings. If a template does not render `{{comment.fingerprint}}`, Code Reviewer
automatically appends the hidden fingerprint marker for idempotency.

When template paths are not configured, Code Reviewer looks for:

- `.gitlab/review_templates/summary.md`
- `.gitlab/review_templates/inline.md`

If no template exists, Code Reviewer uses built-in Markdown output.

### Summary Template Variables

| Variable                            | Description                                      |
| ----------------------------------- | ------------------------------------------------ |
| `review.summary`                    | Model-generated review summary.                  |
| `review.overview.commit`            | Reviewed commit SHA.                             |
| `review.overview.changedFiles`      | Number of changed files.                         |
| `review.overview.findings`          | Number of findings.                              |
| `review.overview.highestSeverity`   | Highest severity, or `none`.                     |
| `review.overview.inlineFindings`    | Findings mapped to inline discussions.           |
| `review.overview.unmappedFindings`  | Findings that could not be mapped to diff lines. |
| `review.overview.publishMode`       | Publish mode: `dry-run`, `summary`, or `inline`. |
| `review.overview.publishModeLabel`  | Human-readable publish mode label.               |
| `review.findings`                   | Finding list for `{{#each review.findings}}`.    |
| `review.findings[].number`          | 1-based finding number.                          |
| `review.findings[].index`           | 0-based finding index.                           |
| `review.findings[].severity`        | Finding severity.                                |
| `review.findings[].severityLabel`   | Formatted severity, such as `High`.              |
| `review.findings[].title`           | Finding title.                                   |
| `review.findings[].body`            | Finding explanation.                             |
| `review.findings[].suggestion`      | Suggested fix text.                              |
| `review.findings[].path`            | Finding path.                                    |
| `review.findings[].side`            | Diff side: `new` or `old`.                       |
| `review.findings[].startLine`       | Start line on the selected side.                 |
| `review.findings[].endLine`         | End line on the selected side.                   |
| `review.findings[].location`        | Formatted location, such as `src/a.ts:7 (new)`.  |
| `review.findings[].code`            | Diff-anchored code.                              |
| `review.findings[].replacementCode` | Applyable replacement code, when available.      |
| `review.metadata.toolCalls`         | Number of tool calls.                            |
| `review.metadata.promptBytes`       | Total prompt byte count.                         |
| `comment.fingerprint`               | Hidden summary de-duplication marker.            |

### Inline Template Variables

| Variable                  | Description                                         |
| ------------------------- | --------------------------------------------------- |
| `finding.severity`        | Finding severity.                                   |
| `finding.title`           | Finding title.                                      |
| `finding.body`            | Finding explanation.                                |
| `finding.suggestion`      | Suggested fix text.                                 |
| `finding.path`            | Finding path.                                       |
| `finding.side`            | Diff side: `new` or `old`.                          |
| `finding.startLine`       | Start line on the selected side.                    |
| `finding.endLine`         | End line on the selected side.                      |
| `finding.code`            | Diff-anchored code.                                 |
| `finding.replacementCode` | Applyable replacement code, when available.         |
| `comment.location`        | Formatted location, such as `src/a.ts:7 (new)`.     |
| `comment.severityLabel`   | Formatted severity, such as `High`.                 |
| `comment.suggestionBlock` | GitLab suggestion block generated by Code Reviewer. |
| `comment.fingerprint`     | Hidden inline de-duplication marker.                |

### `tools`

| Field                                | Default                 | Description                                                            |
| ------------------------------------ | ----------------------- | ---------------------------------------------------------------------- |
| `tools.enabled`                      | all built-in read tools | Tool names the model may call.                                         |
| `tools.limits.maxToolCalls`          | `120`                   | Maximum tool calls for one review.                                     |
| `tools.limits.maxBytesPerToolResult` | `1000000`               | Maximum JSON byte size for one tool result.                            |
| `tools.limits.maxTotalContextBytes`  | `8000000`               | Maximum cumulative tool-result bytes added to context.                 |
| `tools.limits.timeoutMs`             | `60000`                 | Per-tool timeout in milliseconds.                                      |
| `tools.permissions.readRepo`         | `true`                  | Allows reading MR diffs, repository files, and repo search.            |
| `tools.permissions.readGitLab`       | `true`                  | Allows reading GitLab MRs, issues, MR lists, and discussions.          |
| `tools.permissions.shell`            | `false`                 | Reserved for shell-capable tools. Built-in tools do not use it.        |
| `tools.permissions.network`          | `false`                 | Reserved for arbitrary network tools. GitLab reads use `readGitLab`.   |
| `tools.permissions.write`            | `false`                 | Reserved for write-capable tools. Built-in review tools are read-only. |

<!-- markdownlint-enable MD013 -->

Default enabled tools:

```yaml
tools:
  enabled:
    - read_diff
    - read_file
    - repo_search
    - read_gitlab_mr
    - read_gitlab_issue
    - list_gitlab_issues
    - list_gitlab_mrs
    - read_gitlab_mr_discussions
```

Permission mapping:

| Permission   | Built-in tools                            |
| ------------ | ----------------------------------------- |
| `readRepo`   | `read_diff`, `read_file`, `repo_search`   |
| `readGitLab` | `read_gitlab_*` and `list_gitlab_*` tools |

## Minimal Recommended Config

```yaml
gitlab:
  publish: inline
review:
  maxRounds: 12
prompts:
  extraRules:
    - Write review summaries, findings, and suggestions in Chinese.
    - Keep comments concise and focused on actionable issues.
tools:
  limits:
    maxToolCalls: 120
```
