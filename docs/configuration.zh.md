# 配置

[English](configuration.md)

Code Reviewer 配置可以存放在 `.codereviewer.yml`、`.codereviewer.yaml`、
`.codereviewer.json`、`.codereviewer.jsonc`、`package.json#codereviewer`、
`pyproject.toml#[tool.codereviewer]` 或
`Cargo.toml#[package.metadata.codereviewer]` 中。推荐在仓库根目录使用
`.codereviewer.yml`，并添加 schema 注释以获得编辑器支持：

```yaml
# yaml-language-server: $schema=./.schemas/code-reviewer.schema.json
```

所有字段都是可选的。Code Reviewer 会填充默认值，并拒绝未知字段。不要把 API
key、GitLab token、GitHub token 或其他 secrets 写进配置文件。

## 发现顺序

Code Reviewer 使用第一个匹配到的配置来源，不会合并后续来源：

1. 显式传入的 `--config <path>`。
2. `.codereviewer.yml`。
3. `.codereviewer.yaml`。
4. `.codereviewer.json`。
5. `.codereviewer.jsonc`。
6. `package.json#codereviewer`。
7. `pyproject.toml#[tool.codereviewer]`。
8. `Cargo.toml#[package.metadata.codereviewer]`。
9. 内置默认值。

## CLI 选项

`codereviewer review` 支持这些常用选项：

- `--config <path>`：从指定文件加载配置。
- `--dry-run`：不发布平台评论，只打印 review JSON。
- `--verbose`：将可读的进度日志写到 stderr，同时保持 stdout 只输出最终 JSON。

Verbose 日志包含生命周期事件、模型轮次、工具调用摘要和工具结果大小。它们不会
包含完整 prompts、模型响应或原始工具结果。

## 字段

<!-- markdownlint-disable MD013 -->

### `review`

| 字段               | 默认值 | 说明                                      |
| ------------------ | ------ | ----------------------------------------- |
| `review.maxRounds` | `12`   | 请求最终 JSON 前的最大模型/工具循环轮数。 |

### `model`

| 字段                    | 默认值                                                   | 说明                                                                                                                                                                                                            |
| ----------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model.provider`        | `openai-compatible`                                      | 模型提供方。当前只支持 OpenAI 兼容的 chat completions。                                                                                                                                                         |
| `model.apiKeyEnv`       | `OPENAI_API_KEY`                                         | 保存模型 API key 的环境变量。                                                                                                                                                                                   |
| `model.model`           | `OPENAI_MODEL`                                           | 模型名称。未设置时，Code Reviewer 会读取 `OPENAI_MODEL`。                                                                                                                                                       |
| `model.baseUrl`         | 先读 `OPENAI_BASE_URL`，再用 `https://api.openai.com/v1` | OpenAI 兼容 base URL。                                                                                                                                                                                          |
| `model.temperature`     | 未设置                                                   | 透传给模型请求的可选 temperature 值。                                                                                                                                                                           |
| `model.maxOutputTokens` | 未设置                                                   | 透传给模型请求的可选最大输出 token 数。                                                                                                                                                                         |
| `model.timeoutMs`       | `300000`                                                 | 单次模型请求超时时间，单位为毫秒。                                                                                                                                                                              |
| `model.responseFormat`  | `auto`                                                   | 最终报告响应格式：`auto`、`json_schema`、`json_object` 或 `off`。`auto` 会先尝试 `json_schema`，再回退到 `json_object`，如果提供方都拒绝则省略 `response_format`。使用 `off` 可始终依赖 prompt-only JSON 输出。 |

### `provider`

| 字段       | 默认值 | 说明                                                                                                                |
| ---------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `provider` | `auto` | 审查平台：`auto`、`gitlab` 或 `github`。`auto` 会根据环境值检测 GitLab 合并请求 CI 或 GitHub Actions 拉取请求运行。 |

### `gitlab`

| 字段                    | 默认值         | 说明                                                                |
| ----------------------- | -------------- | ------------------------------------------------------------------- |
| `gitlab.tokenEnv`       | `GITLAB_TOKEN` | GitLab token 的环境变量。默认值还会回退读取 `GL_TOKEN`。            |
| `gitlab.publish`        | `dry-run`      | 发布模式：`dry-run`、`summary` 或 `inline`。                        |
| `gitlab.failOnSeverity` | `none`         | 应导致任务失败的最低问题严重度：`none`、`low`、`medium` 或 `high`。 |

### `github`

| 字段                    | 默认值         | 说明                                                                |
| ----------------------- | -------------- | ------------------------------------------------------------------- |
| `github.tokenEnv`       | `GITHUB_TOKEN` | GitHub token 的环境变量。                                           |
| `github.publish`        | `dry-run`      | 发布模式：`dry-run`、`summary` 或 `inline`。                        |
| `github.failOnSeverity` | `none`         | 应导致任务失败的最低问题严重度：`none`、`low`、`medium` 或 `high`。 |

GitHub 审查运行需要 `GITHUB_REPOSITORY`、`GITHUB_EVENT_PATH`，以及
`GITHUB_TOKEN` 或配置的 token 环境变量。GitHub Actions 会为拉取请求 workflow
提供前两项；请把 `secrets.GITHUB_TOKEN` 传给审查步骤的环境变量，这样默认 token
设置就能读取它。

### `prompts`

| 字段                 | 默认值 | 说明                                             |
| -------------------- | ------ | ------------------------------------------------ |
| `prompts.system`     | 未设置 | 追加到内置 system prompt 的仓库相对路径文件。    |
| `prompts.review`     | 未设置 | 追加到内置 review prompt 的仓库相对路径文件。    |
| `prompts.extraRules` | `[]`   | 额外项目规则，例如语言、风格或 suggestion 指南。 |

### `templates`

| 字段                | 默认值   | 说明                                       |
| ------------------- | -------- | ------------------------------------------ |
| `templates.summary` | 自动发现 | summary 评论模板的仓库相对 Markdown 路径。 |
| `templates.inline`  | 自动发现 | 行内审查评论模板的仓库相对 Markdown 路径。 |

Code Reviewer 使用 Handlebars 渲染模板。它不会注册自定义 helpers。未知的简单
占位符会被保留，已知但为空的值会渲染为空字符串。如果模板没有渲染
`{{comment.fingerprint}}`，Code Reviewer 会自动追加隐藏的 fingerprint 标记，
用于幂等发布。

未配置模板路径时，Code Reviewer 会按下面的规则查找：

- 先查当前 provider 目录：GitHub 使用 `.github/`，GitLab 使用 `.gitlab/`。
- 再回退查另一个 provider 目录。
- 在该 provider 目录下查找这些模板目录名：`review_templates`、
  `review_template`、`REVIEW_TEMPLATES` 或 `REVIEW_TEMPLATE`。
- 在选中的模板目录中查找 `summary.md` 和 `inline.md`。

如果没有模板，Code Reviewer 会使用内置 Markdown 输出。

### Summary 模板变量

| 变量                                | 说明                                         |
| ----------------------------------- | -------------------------------------------- |
| `review.summary`                    | 模型生成的审查摘要。                         |
| `review.overview.commit`            | 被审查的 commit SHA。                        |
| `review.overview.changedFiles`      | 变更文件数。                                 |
| `review.overview.findings`          | 问题数量。                                   |
| `review.overview.highestSeverity`   | 最高严重度，或 `none`。                      |
| `review.overview.inlineFindings`    | 映射到行内讨论的问题数量。                   |
| `review.overview.unmappedFindings`  | 无法映射到 diff 行的问题数量。               |
| `review.overview.publishMode`       | 发布模式：`dry-run`、`summary` 或 `inline`。 |
| `review.overview.publishModeLabel`  | 人类可读的发布模式标签。                     |
| `review.findings`                   | `{{#each review.findings}}` 使用的问题列表。 |
| `review.findings[].number`          | 从 1 开始的问题编号。                        |
| `review.findings[].index`           | 从 0 开始的问题索引。                        |
| `review.findings[].severity`        | 问题严重度。                                 |
| `review.findings[].severityLabel`   | 格式化后的严重度，例如 `High`。              |
| `review.findings[].title`           | 问题标题。                                   |
| `review.findings[].body`            | 问题解释。                                   |
| `review.findings[].suggestion`      | 建议修复文本。                               |
| `review.findings[].path`            | 问题路径。                                   |
| `review.findings[].side`            | Diff side：`new` 或 `old`。                  |
| `review.findings[].startLine`       | 所选 side 上的起始行。                       |
| `review.findings[].endLine`         | 所选 side 上的结束行。                       |
| `review.findings[].location`        | 格式化位置，例如 `src/a.ts:7 (new)`。        |
| `review.findings[].code`            | Diff 锚定代码。                              |
| `review.findings[].replacementCode` | 可应用的替换代码，如有。                     |
| `review.metadata.toolCalls`         | 工具调用次数。                               |
| `review.metadata.promptBytes`       | Prompt 总字节数。                            |
| `comment.fingerprint`               | 隐藏的 summary 去重标记。                    |

### Inline 模板变量

| 变量                      | 说明                                     |
| ------------------------- | ---------------------------------------- |
| `finding.severity`        | 问题严重度。                             |
| `finding.title`           | 问题标题。                               |
| `finding.body`            | 问题解释。                               |
| `finding.suggestion`      | 建议修复文本。                           |
| `finding.path`            | 问题路径。                               |
| `finding.side`            | Diff side：`new` 或 `old`。              |
| `finding.startLine`       | 所选 side 上的起始行。                   |
| `finding.endLine`         | 所选 side 上的结束行。                   |
| `finding.code`            | Diff 锚定代码。                          |
| `finding.replacementCode` | 可应用的替换代码，如有。                 |
| `comment.location`        | 格式化位置，例如 `src/a.ts:7 (new)`。    |
| `comment.severityLabel`   | 格式化后的严重度，例如 `High`。          |
| `comment.suggestionBlock` | Code Reviewer 生成的平台 suggestion 块。 |
| `comment.fingerprint`     | 隐藏的行内去重标记。                     |

### `tools`

| 字段                                 | 默认值           | 说明                                                                                       |
| ------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------ |
| `tools.enabled`                      | 所有内置读取工具 | 模型可以调用的工具名称。                                                                   |
| `tools.limits.maxToolCalls`          | `120`            | 单次审查的最大工具调用次数。                                                               |
| `tools.limits.maxBytesPerToolResult` | `1000000`        | 单个工具结果的最大 JSON 字节数。                                                           |
| `tools.limits.maxTotalContextBytes`  | `8000000`        | 添加到上下文中的工具结果累计最大字节数。                                                   |
| `tools.limits.timeoutMs`             | `60000`          | 单个工具超时时间，单位为毫秒。                                                             |
| `tools.permissions.readRepo`         | `true`           | 允许读取 PR/MR diff、仓库文件和仓库搜索。                                                  |
| `tools.permissions.readPlatform`     | `true`           | 允许 GitHub provider-native 读取工具，例如 `read_github_pr` 和 `read_github_pr_comments`。 |
| `tools.permissions.readGitLab`       | `true`           | 允许 GitLab MR、issue、MR 列表和讨论读取工具。                                             |
| `tools.permissions.shell`            | `false`          | 为 shell 能力工具预留。内置工具不会使用。                                                  |
| `tools.permissions.network`          | `false`          | 为任意网络工具预留。平台读取使用上面的读取权限。                                           |
| `tools.permissions.write`            | `false`          | 为写入工具预留。内置审查工具是只读的。                                                     |

<!-- markdownlint-enable MD013 -->

默认启用的工具：

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
    - read_github_pr
    - read_github_pr_comments
```

只有当前 provider 对应的工具会暴露给模型。例如，GitHub 审查运行会暴露仓库工具
和 GitHub 工具，但不会暴露 GitLab 工具。

权限映射：

| 权限           | 内置工具                                |
| -------------- | --------------------------------------- |
| `readRepo`     | `read_diff`、`read_file`、`repo_search` |
| `readPlatform` | `read_github_*` 工具                    |
| `readGitLab`   | `read_gitlab_*` 和 `list_gitlab_*` 工具 |

## 最小推荐配置

GitLab：

```yaml
gitlab:
  publish: inline
review:
  maxRounds: 12
prompts:
  extraRules:
    - 用中文撰写审查摘要、问题和修改建议。
    - 评论保持简洁，并聚焦可操作的问题。
tools:
  limits:
    maxToolCalls: 120
```

GitHub：

```yaml
github:
  publish: inline
review:
  maxRounds: 12
prompts:
  extraRules:
    - 用中文撰写审查摘要、问题和修改建议。
    - 评论保持简洁，并聚焦可操作的问题。
tools:
  limits:
    maxToolCalls: 120
```
